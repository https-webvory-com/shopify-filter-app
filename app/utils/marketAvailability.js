import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
export const marketAvailabilityVersion=ids=>hash(JSON.stringify(ids));
export function createMarketAvailability({redis,queue,fetchImpl=fetch,now=Date.now,readRevision=async()=> '0',ttl=600,refreshAfter=60}){
 const identity=(shop,country)=>{if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||country!=null&&!/^[A-Z]{2}$/.test(country))throw Error('Invalid availability context');return {shop,country:country||null};};
 const key=(shop,country,revision)=>`marketAvailability:${shop}:${country||'default'}:${hash(String(revision))}`;
 async function enqueue(input){
  const jobId='market-availability-'+hash(JSON.stringify(input));const job=await queue.getJob(jobId);
  if(job){const state=await job.getState();if(['waiting','active','delayed','prioritized'].includes(state))return;if(state==='failed'&&now()-(job.finishedOn||0)<60000)return;await job.remove();}
  await queue.add('COLLECTION_MARKET_AVAILABILITY',input,{jobId,priority:1,attempts:3,backoff:{type:'exponential',delay:5000}});
 }
 async function get(shop,country){
  const input={...identity(shop,country),revision:String(await readRevision(shop))};
  let saved;try{saved=JSON.parse(await redis.get(key(shop,input.country,input.revision)));}catch{}
  if(saved?.version===1&&saved.shop===shop&&saved.country===input.country&&saved.revision===input.revision&&Number.isFinite(saved.at)&&saved.at<=now()&&now()-saved.at<ttl*1000&&Array.isArray(saved.ids)&&saved.ids.every(id=>/^\d+$/.test(id))){
   if(now()-saved.at>=refreshAfter*1000)await enqueue(input).catch(()=>{});
   return saved.ids;
  }
  await enqueue(input);return null;
 }
 async function prepare(input){
  const {shop,country}=identity(input.shop,input.country),revision=String(input.revision);
  if(revision!==String(await readRevision(shop)))return {superseded:true};
  const ids=[],seen=new Set(),cursors=new Set();let after=null,more=true;
  const signal=AbortSignal.timeout(120000);
  while(more){
   const response=await fetchImpl(`https://${shop}/api/2026-07/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({
    query:'query MarketAvailability($country:CountryCode,$after:String) @inContext(country:$country){products(first:250,after:$after){nodes{id availableForSale}pageInfo{hasNextPage endCursor}}}',variables:{country,after}})});
   if(!response.ok)throw Error('Shopify market availability unavailable');const body=await response.json(),page=body.data?.products;
   if(body.errors?.length||!Array.isArray(page?.nodes)||typeof page.pageInfo?.hasNextPage!=='boolean')throw Error('Invalid Shopify market availability');
   if(body.extensions?.context?.country&&country&&body.extensions.context.country!==country)throw Error('Shopify availability country mismatch');
   for(const p of page.nodes){const id=String(p?.id||'').replace(/^gid:\/\/shopify\/Product\//,'');if(!/^\d+$/.test(id)||typeof p.availableForSale!=='boolean'||seen.has(id))throw Error('Incomplete Shopify market availability');seen.add(id);if(p.availableForSale)ids.push(id);}
   more=page.pageInfo.hasNextPage;after=page.pageInfo.endCursor;
   if(more&&(!page.nodes.length||typeof after!=='string'||!after||cursors.has(after)))throw Error('Invalid Shopify availability pagination');
   if(after)cursors.add(after);if(seen.size>1000000)throw Error('Shopify availability catalog too large');
  }
  if(revision!==String(await readRevision(shop)))return {superseded:true};
  await redis.setex(key(shop,country,revision),ttl,JSON.stringify({version:1,shop,country,revision,at:now(),ids}));return {products:seen.size,available:ids.length};
 }
 return {get,prepare};
}
