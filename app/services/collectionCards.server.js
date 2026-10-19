import redis from './redis.server.js';
import prisma from '../db.server.js';
import meili from './meiliClient.server.js';
import {createCollectionCardStore} from '../utils/collectionCardStore.js';
import {preparationKey} from '../utils/collectionPreparation.js';
import {readRankedCollectionPage} from '../utils/rankedCollectionPage.js';
import {collectionPageFingerprint} from '../utils/collectionResponse.js';
import {collectionRankingFingerprint,saveCollectionRankingSession} from './collectionRankingSession.server.js';

export function createCardStateReader(redis,database=prisma,now=Date.now){return async({shop,collectionId,preparedKey})=>{
 const [values,schedules]=await Promise.all([
  redis.mget(`collectionPreparationRevision:${shop}`,`collectionProductRevision:${shop}:${collectionId}`,`collectionProductRevision:${shop}:all`,
   `collectionRankingDataRevision:${shop}:all`,`collectionRankingDataRevision:${shop}:${collectionId}`,`collectionOrderSnapshot:${shop}:gid://shopify/Collection/${collectionId}`,preparedKey),
  database.merchandisingRule.findMany({where:{shop,status:true,ruleType:'collection',OR:[{startDate:{not:null}},{endDate:{not:null}}]},select:{id:true,startDate:true,endDate:true},orderBy:{id:'asc'}}),
 ]);
 // Scheduled activation/expiry does not write a configuration epoch. Check it
 // on reads too, including future rules absent from the prepared active rule.
 let scheduleChangedAt=0;
 const time=now(),scheduleEpoch=JSON.stringify(schedules.map(rule=>{
  const start=rule.startDate==null?null:new Date(rule.startDate).getTime(),end=rule.endDate==null?null:new Date(rule.endDate).getTime();
  if(start!=null&&start<=time)scheduleChangedAt=Math.max(scheduleChangedAt,start);
  if(end!=null&&end<time)scheduleChangedAt=Math.max(scheduleChangedAt,end+1);
  return [rule.id,start,end,(start==null||time>=start)&&(end==null||time<=end)];
 }));
 let order;try{order=JSON.parse(values[5]);}catch{}
 return {configuration:String(values[0]??'0'),products:String(values[1]??'0'),globalProducts:String(values[2]??'0'),hardAll:String(values[3]??'0'),hardCollection:String(values[4]??'0'),orderRevision:order?.revision??null,scheduleEpoch,scheduleChangedAt,preparedRaw:values[6]};
};}
const store=createCollectionCardStore({redis,readState:createCardStateReader(redis),
 validateCards:async(entry,prepared)=>{
  const result=await readRankedCollectionPage(meili.index('products'),{ids:prepared.ids,page:1,limit:25,shop:entry.shop,batchOwner:meili,attributes:entry.attributes});
  return collectionPageFingerprint(result.hits)===entry.validationFingerprint;
 },
 createSession:(request,entry,prepared)=>saveCollectionRankingSession(entry.shop,collectionRankingFingerprint(request.url),prepared.ids,entry.sessionUpdatedAt,prepared.metadata),
});
export const getPreparedCollectionCards=store.get;
export const beginPreparedCollectionCards=options=>{
 const canonicalKey=preparationKey(options.spec);
 // A retained older order can keep an existing page usable during a refresh,
 // but must not be promoted to a new long-lived first-page snapshot.
 if(options.preparedKey&&options.preparedKey!==canonicalKey)return null;
 return store.begin({...options,preparedKey:canonicalKey});
};
