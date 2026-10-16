// Run on the app server with its existing environment. Read-only unless --apply.
// --shop example.myshopify.com --ids /path/to/product-ids.json [--apply]
import fs from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import client from '../app/services/meiliClient.server.js';
import { completeProductCollections } from '../app/services/productCollections.server.js';
import { searchIndexProjection } from '../app/utils/searchIndexProjection.js';
import Redis from 'ioredis';
import { REDIS_URL } from '../app/services/redisConnection.server.js';
import { createShopCacheInvalidation } from '../app/utils/shopCacheInvalidation.js';
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const shop = process.argv.includes('--shop') ? arg('--shop') : '';
const file = process.argv.includes('--ids') ? arg('--ids') : '';
if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop) || !file) throw Error('Explicit --shop and --ids are required');
const raw = JSON.parse(await fs.readFile(file, 'utf8'));
if (!Array.isArray(raw) || !raw.length || raw.some(id => !/^(gid:\/\/shopify\/Product\/)?\d+$/.test(String(id)))) throw Error('Expected a nonempty product-ID JSON array');
const ids = [...new Set(raw.map(id => `gid://shopify/Product/${String(id).split('/').pop()}`))];
const apply = process.argv.includes('--apply');
const db = new PrismaClient();
// Avoid importing redis.server: that module starts workers and clears startup caches.
const redis = new Redis(REDIS_URL, {lazyConnect:true, maxRetriesPerRequest:1});
redis.on('error',()=>{});
const invalidateShop = createShopCacheInvalidation({redis});
const changedScopes = new Set();
let attemptedWrites = false;
try {
  const session = await db.session.findFirst({where:{shop,isOnline:false},select:{accessToken:true}});
  if (!session?.accessToken) throw Error('Offline session unavailable');
  const admin = {graphql: async (query, {variables}) => {
    for(let attempt=0;attempt<8;attempt++) {
      const response = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
        method:'POST', headers:{'Content-Type':'application/json','X-Shopify-Access-Token':session.accessToken},
        body:JSON.stringify({query,variables}), signal:AbortSignal.timeout(30000),
      });
      const result = await response.json();
      if(response.status===429 || result.errors?.some(e=>e.extensions?.code==='THROTTLED')) {
        await new Promise(resolve=>setTimeout(resolve,Math.min(1000*2**attempt,15000)));
        continue;
      }
      if(!response.ok || result.errors?.length) throw Error('Shopify membership read failed');
      return {json:async()=>result};
    }
    throw Error('Shopify membership read throttled');
  }};
  const index = client.index('products');
  let checked=0, changed=0;
  for(const id of ids) {
    const existing=await db.product.findFirst({where:{id,shop},select:{id:true,collections:{select:{collectionId:true}}}});
    if(!existing) throw Error(`Product unavailable in this shop: ${id}`);
    const response=await admin.graphql(`query membershipRepair($id: ID!) { product(id:$id) {
      id status publishedAt collections(first:250) { nodes { id title handle } pageInfo { hasNextPage endCursor } }
    } }`,{variables:{id}});
    const product=(await response.json()).data?.product;
    // Avoid mutating other product state through a membership-only repair.
    if(!product || product.status!=='ACTIVE' || !product.publishedAt) throw Error(`Product requires normal lifecycle sync: ${id}`);
    await completeProductCollections(admin,product);
    const numericId=id.split('/').pop();
    const document=await index.getDocument(numericId);
    if(document.shop!==shop) throw Error('Indexed shop mismatch');
    const collections=product.collections.nodes;
    const next=collections.map(c=>c.id);
    const same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
    const differs=!same(existing.collections.map(c=>c.collectionId),next) || !same(document.collections||[],next) || !same(document.collection_titles||[],collections.map(c=>c.title));
    checked++;
    if(differs) {
      changed++;
      if(apply) {
        for(const scope of [...next,...existing.collections.map(c=>c.collectionId)]) changedScopes.add(scope);
        attemptedWrites=true;
        await db.$transaction(async tx=>{
          for(const c of collections) await tx.collection.upsert({where:{id:c.id},create:{...c,shop},update:{title:c.title,handle:c.handle}});
          await tx.productCollection.deleteMany({where:{productId:id,collectionId:{notIn:next}}});
          await tx.productCollection.createMany({data:next.map(collectionId=>({productId:id,collectionId})),skipDuplicates:true});
        },{timeout:30000});
        const titles=collections.map(c=>c.title);
        const projection=searchIndexProjection({...document,collection_titles:titles});
        // Partial document update preserves prices, variants, stock and other projections.
        const task=await index.updateDocuments([{id:document.id,collections:next,collection_titles:titles,cfpSearchCollections:projection.cfpSearchCollections}]);
        const done=await client.tasks.waitForTask(task.taskUid,{timeout:120000});
        if(done.status!=='succeeded') throw Error('Membership indexing failed; rerun the same repair to reconcile');
      }
    }
    if(checked%25===0) console.log(JSON.stringify({apply,checked,changed,total:ids.length}));
  }
  console.log(JSON.stringify({apply,checked,changed,total:ids.length,complete:true}));
} finally {
  // Also invalidate on partial failure; reruns reconcile DB/index differences.
  try {
    // Explicit repair invalidates prepared rankings immediately, including fresh ones.
    if(attemptedWrites) await invalidateShop(shop,{kind:'configuration',collectionIds:[...changedScopes]});
  }
  finally { redis.disconnect(); await db.$disconnect(); }
}
