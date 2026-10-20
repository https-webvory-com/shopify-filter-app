import {decodePreparation} from './collectionPreparationPayload.js';
import {createCollectionDependencies} from './collectionDependencies.js';
import {createCollectionSalesDependencies,collectionSalesEpochKey} from './collectionSalesDependencies.js';
import {productContentRevisionKey} from './shopCacheInvalidation.js';
export function createCardStateReader(redis,database,now=Date.now,loadDurable=async()=>null,getGeneration){return async({shop,collectionId,preparedKey})=>{
 const [values,schedules]=await Promise.all([
  redis.mget(`collectionPreparationRevision:${shop}`,`collectionProductRevision:${shop}:${collectionId}`,`collectionProductRevision:${shop}:all`,
   `collectionRankingDataRevision:${shop}:all`,`collectionRankingDataRevision:${shop}:${collectionId}`,`collectionOrderSnapshot:${shop}:gid://shopify/Collection/${collectionId}`,preparedKey,`collectionLoadingGeneration:${shop}`,productContentRevisionKey(shop,collectionId),collectionSalesEpochKey(shop)),
  database.merchandisingRule.findMany({where:{shop,status:true,ruleType:'collection',OR:[{startDate:{not:null}},{endDate:{not:null}}]},select:{id:true,startDate:true,endDate:true},orderBy:{id:'asc'}}),
 ]);
 if(values[7]==null&&getGeneration)values[7]=await getGeneration(shop);
 if(!values[6])values[6]=await loadDurable({shop,kind:'ranking',key:preparedKey});
 let prepared;try{prepared=decodePreparation(values[6]);}catch{}
 const externalProducts=prepared?.externalDependencies?await createCollectionDependencies(redis).revision(shop,prepared.externalDependencies):undefined;
 const salesProducts=prepared?.salesDependencies?await createCollectionSalesDependencies(redis).revision(shop,prepared.salesDependencies):undefined;
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
 const content=prepared?.productRevisionSource==='content-v1';
 return {configuration:String(values[0]??'0'),products:String(values[content?8:1]??'0'),globalProducts:String(values[2]??'0'),externalProducts,salesProducts,salesEpoch:values[9]??null,hardAll:String(values[3]??'0'),hardCollection:String(values[4]??'0'),epochsPresent:values.slice(0,5).every(value=>value!=null)&&(!content||values[8]!=null),orderRevision:order?.revision??null,scheduleEpoch,scheduleChangedAt,runtimeGeneration:values[7]??null,preparedRaw:values[6]};
};}
