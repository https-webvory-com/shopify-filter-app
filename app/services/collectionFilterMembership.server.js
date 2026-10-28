import {createHash} from 'node:crypto';
import redis from './redis.server.js';
import {productRevisionKey,productContentRevisionKey,rankingDataRevisionKey} from '../utils/shopCacheInvalidation.js';
import {collectionSalesEpochKey} from '../utils/collectionSalesDependencies.js';

// A parent result may narrow only while its product, rule, order and market
// inputs still match the current request. Any uncertainty uses full ranking.
export async function collectionMembershipProof({shop,collectionId,configuration,marketVersion,rule,pinningRule,mergedValues,globalSettings,orderRevision}){
 const id=String(collectionId||'all').split('/').pop();
 const keys=[`collectionPreparationRevision:${shop}`,productRevisionKey(shop,'all'),productRevisionKey(shop,id),
  productContentRevisionKey(shop,'all'),productContentRevisionKey(shop,id),
  rankingDataRevisionKey(shop),rankingDataRevisionKey(shop,id),collectionSalesEpochKey(shop)];
 const values=redis.mget?await redis.mget(...keys):await Promise.all(keys.map(key=>redis.get(key)));
 if(String(values[0]??'0')!==String(configuration))return null;
 return createHash('sha256').update(JSON.stringify([shop,id,values.map(value=>String(value??'0')),
  marketVersion??null,orderRevision??null,rule??null,pinningRule??null,mergedValues??[],globalSettings??{}])).digest('hex');
}
