import {createHash,randomUUID} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean=id=>String(id).split('/').pop();
export const collectionSalesEpochKey=shop=>`collectionSalesEpoch:${shop}`;
const fallbackKey=shop=>`collectionSalesFallback:${shop}`;
const productKey=(shop,id)=>`collectionSalesInput:${shop}:${id}`;
const valid=d=>d?.version===1&&(d.ids===null||Array.isArray(d.ids)&&d.ids.length<=1000&&d.ids.every(id=>/^\d+$/.test(id))&&new Set(d.ids).size===d.ids.length);
const initialize=`for i=1,#KEYS do redis.call('SET',KEYS[i],ARGV[i],'NX') end return redis.call('MGET',unpack(KEYS))`;
const advance=`redis.call('SET',KEYS[1],ARGV[1]) for i=2,#KEYS do if ARGV[#KEYS+1]=='XX' then redis.call('SET',KEYS[i],ARGV[i],'XX') else redis.call('SET',KEYS[i],ARGV[i]) end end return 1`;
export function createCollectionSalesDependencies(redis){
 async function readKeys(keys,initializeMissing=false){
  let values=redis.mget?await redis.mget(...keys):await Promise.all(keys.map(k=>redis.get(k)));
  if(initializeMissing&&values.some(v=>v==null)){
   const initial=key=>(key.startsWith('collectionSalesEpoch:')?'b.':'')+randomUUID();
   if(redis.eval)values=await redis.eval(initialize,keys.length,...keys,...keys.map(initial));
   else {for(const key of keys)await redis.set(key,initial(key),'NX');values=await Promise.all(keys.map(k=>redis.get(k)));}
  }
  return values.some(v=>v==null)?null:values;
 }
 async function epoch(shop){return (await readKeys([collectionSalesEpochKey(shop)],true))?.[0];}
 async function revision(shop,descriptor,initializeMissing=false){
  if(!valid(descriptor))return null;
  const keys=descriptor.ids===null?[collectionSalesEpochKey(shop)]:[fallbackKey(shop),...descriptor.ids.map(id=>productKey(shop,id))];
  const values=await readKeys(keys,initializeMissing);
  return values?'s1.'+hash([descriptor.ids,values]):null;
 }
 async function snapshot(spec,value){
  // Native best-selling positions come from Shopify, not our sales scores.
  // Only outside Include candidates retain the engine's score tie order.
  const outside=value.sourceOutsideIds;
  const ids=spec.needsShopifyOrder===true&&['best-selling','bestselling'].includes(spec.sortBy)&&Array.isArray(outside)&&outside.length<=1000&&outside.every(id=>/^\d+$/.test(clean(id)))
   ?[...new Set(outside.map(clean))].sort():null;
  const descriptor={version:1,ids};return {...descriptor,revision:await revision(spec.shop,descriptor,true)};
 }
 async function changed(shop,ids){
  const precise=Array.isArray(ids)&&ids.length>0&&ids.length<=2000&&ids.every(id=>/^\d+$/.test(clean(id)));
  const keys=[collectionSalesEpochKey(shop),...(precise?[...new Set(ids.map(clean))].map(id=>productKey(shop,id)):[fallbackKey(shop)])];
  if(redis.eval)await redis.eval(advance,keys.length,...keys,...keys.map((_,i)=>(i===0?'e.':'')+randomUUID()),precise?'XX':'');
  else {await redis.set(keys[0],'e.'+randomUUID());for(const key of keys.slice(1))await redis.set(key,randomUUID(),...(precise?['XX']:[]));}
 }
 return {epoch,snapshot,revision:(shop,d)=>revision(shop,d),matches:async(shop,d)=>Boolean(valid(d)&&typeof d.revision==='string'&&await revision(shop,d)===d.revision),changed};
}
