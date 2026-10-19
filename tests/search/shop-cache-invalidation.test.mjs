import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationRevisionKey,productRevisionKey,rankingDataRevisionKey,isOwnedShopCache,productRankingFingerprint,createShopCacheInvalidation} from '../../app/utils/shopCacheInvalidation.js';

const shop='fixture.myshopify.com';
function fixture(){
  const values=new Map(),calls=[];
  const redis={incr:async key=>{const value=Number(values.get(key)||0)+1;values.set(key,String(value));return value;},scan:async()=>['0',[...values.keys()]],del:async(...keys)=>{keys.forEach(key=>values.delete(key));return keys.length;}};
  return {values,calls,invalidate:createShopCacheInvalidation({redis,warm:async(...args)=>calls.push(args)})};
}
test('configuration invalidation only deletes owned cache namespaces and preserves BullMQ metadata',async()=>{
  const f=fixture();const protectedKeys=[`bull:queue:warm-${shop}`,`bull:queue:warm-${shop}:lock`,`collectionWarmupContextsV2:${shop}`,`collectionProductRevision:${shop}:1`,`collectionOrder:${shop}:1`,`rankingToken:${shop}:token`,`merch:other.${shop}`];
  for(const key of protectedKeys)f.values.set(key,'protected');
  f.values.set(`merch:${shop}:1`,'old');f.values.set(`collectionPreparedSequence:${shop}:background-v2:hash`,'old');
  await f.invalidate(shop);
  for(const key of protectedKeys)assert.equal(f.values.get(key),'protected',key);
  assert.equal(f.values.has(`merch:${shop}:1`),false);assert.equal(f.values.get(`collectionPreparedSequence:${shop}:background-v2:hash`),'old');
  assert.equal(f.values.get(configurationRevisionKey(shop)),'1');assert.deepEqual(f.calls,[[shop,null]]);
  assert.equal(isOwnedShopCache(`merch:${shop}.other:1`,shop),false);
});

test('membership and bulk catalog invalidations retain records but invalidate only the required data epochs',async()=>{
 const f=fixture(),key=`collectionPreparedSequence:${shop}:background-v2:hash`;
 f.values.set(key,'saved');
 await f.invalidate(shop,{kind:'catalog',collectionIds:['gid://shopify/Collection/1','1']});
 assert.equal(f.values.get(rankingDataRevisionKey(shop,'1')),'1');assert.equal(f.values.has(rankingDataRevisionKey(shop,'2')),false);
 assert.equal(f.values.has(rankingDataRevisionKey(shop)),false);assert.equal(f.values.get(key),'saved');assert.deepEqual(f.calls[0],[shop,['1']]);
 await f.invalidate(shop,{kind:'catalog'});assert.equal(f.values.get(rankingDataRevisionKey(shop)),'1');assert.equal(f.values.get(key),'saved');
});
test('product invalidation advances only relevant data versions and keeps usable prepared sequences',async()=>{
  const f=fixture();const prepared=`collectionPreparedSequence:${shop}:background-v2:hash`;
  f.values.set(prepared,'ranking');f.values.set(`availableVariants:${shop}:query`,'old');
  f.values.set(`searchRankingCandidates:${shop}:query`,'old');
  await f.invalidate(shop,{kind:'products',collectionIds:['gid://shopify/Collection/1','1','all']});
  assert.equal(f.values.get(productRevisionKey(shop,'1')),'1');assert.equal(f.values.get(productRevisionKey(shop,'all')),'1');
  assert.equal(f.values.has(productRevisionKey(shop,'2')),false);assert.equal(f.values.has(configurationRevisionKey(shop)),false);
  assert.equal(f.values.get(prepared),'ranking');assert.equal(f.values.has(`availableVariants:${shop}:query`),false);
  assert.equal(f.values.has(`searchRankingCandidates:${shop}:query`),false);
  assert.deepEqual(f.calls,[[shop,['1','all']]]);
});
test('no-op indexed updates have the same fingerprint while ranking-relevant changes differ',()=>{
  const product={id:'1',tags:['blue'],inventoryTotal:5,variantPrices:[{price:10,available:true}],updatedAt:1,_vectors:{openai:[1]}};
  assert.equal(productRankingFingerprint(product),productRankingFingerprint({...product,updatedAt:2,_vectors:{openai:[2]}}));
  assert.equal(productRankingFingerprint(product),productRankingFingerprint({...product,cfpCollectionFactProfile:'new',cfpCollectionFactSource:'derived',cfpCollectionFactMatches:['match:b'],cfpCollectionFactImages:{match:'red.jpg'}}));
  for(const change of [{inventoryTotal:0},{tags:['red']},{variantPrices:[{price:0,available:true}]},{collections:['2']}])assert.notEqual(productRankingFingerprint(product),productRankingFingerprint({...product,...change}));
});
