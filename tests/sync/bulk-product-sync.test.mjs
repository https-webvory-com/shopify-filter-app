import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as marketPricingIndex from '../../app/utils/marketPricingIndex.js';
import * as productMarketPrices from '../../app/utils/readProductMarketPrices.js';

const shop = 'fixture.myshopify.com';
const active = { id: 'gid://shopify/Product/1', status: 'ACTIVE', publishedAt: '2026-10-01', collections: { nodes: [] } };
const draft = { id: 'gid://shopify/Product/2', status: 'DRAFT', publishedAt: null, collections: { nodes: [] } };

async function fixture({ indexFails = false, bulkProducts = [active, draft], payloadFails = null, delayMs = 0 } = {}) {
  const writes = [], indexed = [], checks = [];
  let indexTasks=0;
  let inFlight = 0, maxConcurrent = 0, locationReads = 0;
  const job = { id: 'bulk-job', shop, kind: 'BULK_PRODUCTS', status: 'IN_PROGRESS', cursor: 'gid://shopify/BulkOperation/7', productsProcessed: 0 };
  const prisma = { filterGroupItem: { findFirst: async () => { locationReads++; return null; } }, syncJob: {
    findUnique: async () => job,
    update: async ({ data }) => { writes.push(data); Object.assign(job, data); return job; },
  } };
  const index = { addDocuments: async docs => { if (indexFails) throw Error('index unavailable'); indexTasks++; indexed.push(...docs); return { taskUid: 1 }; } };
  const bulk = { bulkProductIndexStatus: async () => ({ status: 'complete', url: 'https://storage.test/file', count: bulkProducts.length, objectCount: bulkProducts.length }),
    streamBulkProductIndex: async ({ onRoot, onProduct, skip }) => {
      for (const [offset, product] of bulkProducts.entries()) {
        await onRoot(product, offset + 1);
        if (offset + 1 > skip) await onProduct(product, offset + 1);
      }
      return bulkProducts.length;
    } };
  const drift = { missing: [], extra: [], statusMismatch: [] };
  const audit = { auditCatalogDrift: async ({ bulkProducts }) => { checks.push(bulkProducts.map(p => p.id)); return drift; },
    auditSearchIndexDrift: async ({ bulkProducts }) => { checks.push(bulkProducts.map(p => p.id)); return drift; } };
  const source = (await fs.readFile('app/services/sync.server.js', 'utf8'))
    .replace("await import('./shopifyBulkIndex.server.js')", 'bulk')
    .replace("await import('./shopifyBulkCatalog.server.js')", 'audit')
    .replace("await import('./orders.server.js')", 'orders')
    .replace("await syncProductPayload(shop, admin, product.id, product, { retrySearchErrors: true, deferIndex: true, wantsLocations, collectionUpserts })", 'await fakePayload(product)')
    .replaceAll('await autoSeedOptionFilters(shop)', 'await pretendSeed(shop)')
    .replaceAll('await updateMeiliSettings(shop, { throwOnError: true })', 'await pretendSettings(shop)');
  const mocks = {
    '../utils/readProductMarketPrices.js':productMarketPrices,
    '../db.server': { __esModule: true, default: prisma },
    './meiliClient.server': { __esModule: true, default: { index: () => index, tasks: { waitForTask: async () => ({ status: 'succeeded' }) } } },
    './shopCache.server': { invalidateShop: async () => {} },
    './productCollections.server.js': { verifyMembershipWrites: async (_db, _index, _shop, products, docs) => {
      assert.equal(products.length, docs.length);
      for (let i = 0; i < docs.length; i++) assert.equal(docs[i].id, products[i].id.split('/').pop());
    } },
    '../utils/storefrontProduct.js': { isStorefrontProduct: p => p.status === 'ACTIVE' && !!p.publishedAt },
    '../utils/searchIndexProjection.js': { searchIndexProjection: () => ({}) },
    './collectionRuleFacts.server.js': { withCollectionRuleFacts: async docs => docs },
    '../utils/embeddingHold.js': { withHeldEmbeddingsForIndex: async (_index, docs) => docs },
    '../utils/marketPricingIndex.js': marketPricingIndex,
    './searchIndex.server.js': { scheduleSearchIndexProducts: async () => {} },
  };
  const ctx = { module: { exports: {} }, exports: {}, require: name => mocks[name] || {}, bulk, audit,
    orders: { syncHistoricalOrders: async () => true }, fakePayload: async product => {
      inFlight++; maxConcurrent = Math.max(maxConcurrent, inFlight);
      try {
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
        if (product.id === payloadFails) throw Error('product write failed');
        return product.status !== 'ACTIVE' ? null :
          { product, meiliDoc: { id: product.id.split('/').pop(), shop, status: 'ACTIVE', collections: [] } };
      } finally { inFlight--; }
    },
    pretendSeed: async () => {}, pretendSettings: async () => {}, console: { log() {} }, process: { env: {} } };
  vm.runInNewContext((await transform(source, { format: 'cjs' })).code, ctx);
  return { run: () => ctx.module.exports.runBulkProductSync(job.id, shop, {}), persist: ctx.module.exports.smartUpsertProduct,
    job, writes, indexed, checks,
    maxConcurrent: () => maxConcurrent, locationReads: () => locationReads, indexTasks: () => indexTasks };
}

test('bulk sync commits complete batches, excludes drafts, verifies both stores and completes', async () => {
  const f = await fixture();
  const result = await f.run();
  assert.equal(result.status, 'complete');
  assert.equal(f.job.productsProcessed, 2);
  assert.equal(f.job.status, 'COMPLETED');
  assert.deepEqual(f.indexed.map(doc => doc.id), ['1']);
  assert.deepEqual(JSON.parse(JSON.stringify(f.checks)), [[active.id], [active.id]]);
});

test('bulk import upserts shared collection metadata once while retaining each product link',async()=>{
  const f=await fixture();
  const collections=[],links=[];
  const db={
    product:{upsert:async()=>{}},variant:{deleteMany:async()=>{},upsert:async()=>{}},
    collection:{upsert:async({where})=>{collections.push(where.id);}},
    productCollection:{findMany:async()=>[],createMany:async({data})=>{links.push(...data);}},
    productMetafield:{deleteMany:async()=>{}},
    $transaction:async operations=>Promise.all(operations),
  };
  const shared={id:'gid://shopify/Collection/7',title:'Formal',handle:'formal'};
  const product=id=>({id:`gid://shopify/Product/${id}`,title:'Dress',handle:'dress',vendor:'Vendor',
    productType:'Dress',tags:[],images:{nodes:[]},options:[],status:'ACTIVE',variants:{nodes:[]},
    collections:{nodes:[shared]},metafields:{nodes:[]}});
  const collectionUpserts=new Map();
  await Promise.all([f.persist(shop,product(1),db,{collectionUpserts}),f.persist(shop,product(2),db,{collectionUpserts})]);
  assert.deepEqual(collections,[shared.id]);
  assert.deepEqual(links.map(link=>link.productId).sort(),[product(1).id,product(2).id]);
});

test('bulk import verifies one search task per 100 roots',async()=>{
  const bulkProducts=Array.from({length:100},(_,index)=>({...active,id:`gid://shopify/Product/${index+1}`}));
  const f=await fixture({bulkProducts});
  await f.run();
  assert.equal(f.indexTasks(),1);
  assert.equal(f.job.productsProcessed,100);
  assert.equal(f.indexed.length,100);
});

test('bulk sync does not advance its checkpoint when search indexing fails', async () => {
  const f = await fixture({ indexFails: true });
  await assert.rejects(f.run(), /index unavailable/);
  assert.equal(f.job.productsProcessed, 0);
  assert.equal(f.job.status, 'IN_PROGRESS');
  assert.equal(f.checks.length, 0);
});

test('bulk sync runs four product writes at once and advances only after verified indexing', async () => {
  const bulkProducts = Array.from({ length: 20 }, (_, index) => ({ ...active, id: `gid://shopify/Product/${index + 1}` }));
  const f = await fixture({ bulkProducts, delayMs: 5 });
  await f.run();
  assert.equal(f.maxConcurrent(), 4);
  assert.equal(f.locationReads(), 1);
  assert.equal(f.indexed.length, 20);
  assert.equal(f.job.productsProcessed, 20);
  const failed = await fixture({ bulkProducts, delayMs: 5, payloadFails: bulkProducts[8].id });
  await assert.rejects(failed.run(), /product write failed/);
  assert.equal(failed.job.productsProcessed, 0);
  assert.equal(failed.indexed.length, 0);
});
