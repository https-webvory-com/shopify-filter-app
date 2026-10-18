import redis from './redis.server.js';
import prisma from '../db.server.js';
import {collectionMembershipQueue} from './queue.server.js';
import {createHash} from 'node:crypto';

const validShop=shop=>/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);
export async function scheduleMembershipAudits() {
  const shops=await prisma.collection.findMany({distinct:['shop'],select:{shop:true}});
  for(const {shop} of shops){
    if(!validShop(shop))continue;
    // Full sync already verifies its writes; avoid competing for its API budget.
    if(await prisma.syncJob.findFirst({where:{shop,status:'IN_PROGRESS',updatedAt:{gte:new Date(Date.now()-900000)},OR:[{kind:'PRODUCTS'},{kind:null}]},select:{id:true}}))continue;
    const id='memberships-'+createHash('sha256').update(shop).digest('hex');
    const existing=await collectionMembershipQueue.getJob(id);
    if(existing){const state=await existing.getState();if(['waiting','active','prioritized','delayed'].includes(state))continue;await existing.remove();}
    await collectionMembershipQueue.add('VERIFY_COLLECTION_MEMBERSHIP',{shop},{jobId:id});
  }
}

export async function processMembershipAudit({shop}) {
  if(!validShop(shop))throw Error('Invalid membership audit shop');
  const {unauthenticated}=await import('../shopify.server.js');
  const {admin}=await unauthenticated.admin(shop);
  const catalogKey=`membershipPublishedCatalog:${shop}`,cursorKey=`membershipAuditCursor:${shop}`,statusKey=`membershipAuditStatus:${shop}`;
  let collectionId=null;
  try {
    let catalog;const cached=await redis.get(catalogKey);if(cached)catalog=JSON.parse(cached);
    if(!Array.isArray(catalog)){
      catalog=[];let cursor=null;const seen=new Set();
      do{const response=await admin.graphql(`query membershipAuditCatalog($cursor:String){collections(first:250,after:$cursor,query:"published_status:published"){nodes{id title handle} pageInfo{hasNextPage endCursor}}}`,{variables:{cursor}});const data=await response.json(),page=data.data?.collections;
        if(data.errors?.length||!Array.isArray(page?.nodes)||typeof page.pageInfo?.hasNextPage!=='boolean')throw Error('Published membership audit catalog unavailable');
        catalog.push(...page.nodes);if(!page.pageInfo.hasNextPage)break;
        const next=page.pageInfo.endCursor;if(!page.nodes.length||!next||seen.has(next))throw Error('Membership audit catalog cursor did not advance');seen.add(next);cursor=next;
      }while(true);
      catalog.sort((a,b)=>a.id.localeCompare(b.id));await redis.setex(catalogKey,3600,JSON.stringify(catalog));
    }
    if(!catalog.length)return {verified:true,collections:0};
    const previous=await redis.get(cursorKey),collection=catalog.find(c=>c.id>previous)||catalog[0];
    collectionId=collection.id;
    if(!/^gid:\/\/shopify\/Collection\/\d+$/.test(collection.id))throw Error('Invalid canonical collection identity');
    const owner=await prisma.collection.findUnique({where:{id:collection.id},select:{shop:true}});
    if(owner&&owner.shop!==shop)throw Error('Membership audit collection ownership mismatch');
    await prisma.collection.upsert({where:{id:collection.id},create:{...collection,shop},update:{title:collection.title,handle:collection.handle}});
    const {syncCollectionProducts}=await import('./sync.server.js');
    const result=await syncCollectionProducts(shop,admin,collection.id,{throwOnError:true});
    if(!result?.verified)throw Error('Membership audit did not verify');
    if(result.repaired){const {invalidateCollectionBestSelling,getCollectionBestSellingState}=await import('./collectionBestSelling.server.js');await invalidateCollectionBestSelling(shop,collection.id);await getCollectionBestSellingState(shop,collection.id,{warmup:true});}
    const status={shop,collectionId:collection.id,verifiedAt:new Date().toISOString(),...result,publishedCollections:catalog.length};
    // Only verified work advances the rolling cursor. Failed jobs remain retryable.
    await redis.set(statusKey,JSON.stringify(status));await redis.set(cursorKey,collection.id);
    console.log('CFP Membership audit verified:',JSON.stringify(status));return status;
  }catch(error){await redis.set(statusKey,JSON.stringify({shop,collectionId,verified:false,failedAt:new Date().toISOString(),error:error.name}));throw error;}
}
