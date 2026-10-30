import redis from './redis.server.js';
import {createShopCacheInvalidation,configurationRevisionKey,productRevisionKey} from '../utils/shopCacheInvalidation.js';
const TTL_SEC=60;
const pendingReads=new Map();
let cacheGeneration=0;
export async function getCached(key,fetchFn,ttl=TTL_SEC) {
  const generation=cacheGeneration;
  const shop=key.match(/(?:^|:)([a-z0-9][a-z0-9-]*\.myshopify\.com)(?=:|$)/i)?.[1];
  let cacheKey=key;
  if(shop) {
    try {
      const config=await redis.get(configurationRevisionKey(shop)) ?? '0';
      const products=/^(availableVariants|percentSale|extraFilterFacts|queryParserFacets|contextualPricing|collectionPageIds|searchRankingCandidates|searchNativeReady|searchInstant):/.test(key) ? await redis.get(productRevisionKey(shop,'all')) ?? '0' : '0';
      cacheKey=`${key}:revision:${config}:${products}`;
    } catch(error) {console.error('CFP: Cache revision unavailable:',error.name);}
  }
  try {const raw=await redis.get(cacheKey);if(raw)return JSON.parse(raw);} catch(error) {console.error('CFP: Cache read unavailable:',error.name);}
  if(pendingReads.has(cacheKey))return pendingReads.get(cacheKey);
  const pending=(async()=>{
    const value=await fetchFn();
    if(generation===cacheGeneration&&value!==undefined&&value!==null) {
      try{await redis.setex(cacheKey,ttl,JSON.stringify(value));}catch(error){console.error('CFP: Cache write unavailable:',error.name);}
    }
    return value;
  })();
  pendingReads.set(cacheKey,pending);
  try{return await pending;}finally{if(pendingReads.get(cacheKey)===pending)pendingReads.delete(cacheKey);}
}
const invalidate=createShopCacheInvalidation({redis,warm:async(shop,collectionIds)=>{
  try{const {scheduleCollectionWarmup}=await import('./collectionPreparation.server.js');await scheduleCollectionWarmup(shop,collectionIds);}
  catch(error){console.error('CFP: Could not schedule collection warmup:',error.name);}
}});
export async function invalidateShop(shop,options) {
  cacheGeneration++;pendingReads.clear();
  return invalidate(String(shop),options);
}
export async function getCacheStats() {
  try {
    const keys = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', '*', 'COUNT', 200);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    const uniqueKeys = [...new Set(keys)];
    return {size: uniqueKeys.length, ttlSec: TTL_SEC, keys: uniqueKeys};
  } catch (error) {
    console.error('CFP Redis stats error:', error);
    return {};
  }
}
