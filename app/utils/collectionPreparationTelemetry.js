export const collectionTelemetryKey=shop=>`collectionPreparationTelemetry:${shop}`;
export function createCollectionPreparationTelemetry(redis,{now=Date.now}={}){
 return async event=>{
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(event.shop||''))return;
  const key=collectionTelemetryKey(event.shop),sample={...event,at:now()};
  const p=redis.pipeline();p.hincrby(key,'event:'+event.event,1);
  if(event.reason)p.hincrby(key,'reason:'+event.reason,1);
  for(const field of ['buildMs','queueWaitMs','readMs'])if(Number.isFinite(event[field])){
   p.hincrby(key,field+':total',Math.round(event[field]));p.hincrby(key,field+':count',1);
  }
  p.hset(key,'lastAt',String(sample.at));p.expire(key,7*86400);
  p.lpush(key+':recent',JSON.stringify(sample));p.ltrim(key+':recent',0,299);p.expire(key+':recent',7*86400);
  const result=await p.exec();if(result.some(([error])=>error))throw Error('Collection telemetry write failed');
 };
}
