import {createHash} from 'node:crypto';
import {decodePreparation,encodePreparation} from './collectionPreparationPayload.js';
import {isPublicCollectionCards,collectionCardsResponse} from './collectionCards.js';

const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const clean=id=>String(id).split('/').pop();
export function collectionCardKey(request){
 if(!isPublicCollectionCards(request))return null;
 const url=new URL(request.url);url.searchParams.sort();
 return `collectionFirstPage:${url.searchParams.get('shop')}:${digest(url.pathname+'?'+url.searchParams)}`;
}
const retain=`
local old=redis.call('HGET',KEYS[2],KEYS[3])
redis.call('SETEX',KEYS[3],ARGV[1],ARGV[2])
redis.call('HSET',KEYS[2],KEYS[3],string.len(ARGV[2]))
redis.call('ZADD',KEYS[1],ARGV[3],KEYS[3])
redis.call('EXPIRE',KEYS[1],ARGV[1]);redis.call('EXPIRE',KEYS[2],ARGV[1])
local total=0
for _, size in ipairs(redis.call('HVALS',KEYS[2])) do total=total+tonumber(size) end
local keys=redis.call('ZRANGE',KEYS[1],0,-1);local count=#keys
for _, key in ipairs(keys) do
 if count<=tonumber(ARGV[4]) and total<=tonumber(ARGV[5]) then break end
 local suffix=string.sub(key,string.len(ARGV[6])+1)
 if string.sub(key,1,string.len(ARGV[6]))==ARGV[6] and string.len(suffix)==64 and string.match(suffix,'^%x+$') then redis.call('DEL',key) end
 total=total-tonumber(redis.call('HGET',KEYS[2],key) or '0')
 redis.call('HDEL',KEYS[2],key);redis.call('ZREM',KEYS[1],key);count=count-1
end
return 1`;

// A card snapshot contains no facets. Every read still verifies current cards,
// data/configuration epochs, the backing ranking and the native order revision.
export function createCollectionCardStore({redis,readState,validateCards,createSession,now=Date.now,maxEntries=1024,maxBytes=24*1024*1024,maxEntryBytes=128*1024,lifetime=86400,readBudgetMs=500}){
 const sourceValid=(shop,key)=>typeof key==='string'&&key.startsWith(`collectionPreparedSequence:${shop}:background-v2:`)&&/^[a-f0-9]{64}$/.test(key.split(':').at(-1));
 const stateSignature=(state,external)=>JSON.stringify([state.configuration,state.products,external?state.globalProducts:null,state.hardAll,state.hardCollection,state.orderRevision,state.scheduleEpoch]);
 const sequenceSignature=value=>digest([value.ids,value.metadata]);
 function current(state,external){
  if(!state?.preparedRaw||typeof state.orderRevision!=='string'||!state.orderRevision)return null;
  let prepared;try{prepared=decodePreparation(state.preparedRaw);}catch{return null;}
  if(!Array.isArray(prepared?.ids)||!prepared.metadata||!Number.isFinite(prepared.preparedAt)||now()-prepared.preparedAt>=lifetime*1000||prepared.productRevision!==state.products)return null;
  const epochs=typeof prepared.reusableDataRevision==='string'?prepared.reusableDataRevision.split(':'):[];
  if(epochs[0]!==state.hardAll||epochs[1]!==state.hardCollection||external&&epochs[2]!==state.globalProducts)return null;
  return prepared;
 }
 async function get(request){
  const key=collectionCardKey(request);if(!key)return null;
  const controller=new AbortController(),started=now();let timer;
  const work=async()=>{
  try{
   const shop=new URL(request.url).searchParams.get('shop');
   let entry;try{entry=decodePreparation(await redis.get(key));}catch{return null;}
   controller.signal.throwIfAborted();
   if(entry?.version!==1||entry.shop!==shop||!/^\d+$/.test(entry.collectionId)||!sourceValid(shop,entry.preparedKey)||!Array.isArray(entry.attributes)||!entry.validationFingerprint||!entry.payload?.products||!Number.isFinite(entry.at)||now()-entry.at>=lifetime*1000)return null;
   const before=await readState(entry),prepared=current(before,entry.external);
   controller.signal.throwIfAborted();
   if(!prepared||before.configuration!==entry.configuration||stateSignature(before,entry.external)!==entry.state||sequenceSignature(prepared)!==entry.sequence)return null;
   const readStarted=now();if(!await validateCards(entry,prepared))return null;
   const readMs=now()-readStarted;controller.signal.throwIfAborted();
   const session=await createSession(request,entry,prepared);
   const after=await readState(entry),afterPrepared=current(after,entry.external);
   controller.signal.throwIfAborted();
   if(!afterPrepared||stateSignature(after,entry.external)!==entry.state||sequenceSignature(afterPrepared)!==entry.sequence)return null;
   return collectionCardsResponse({...entry.payload,rankingToken:session.token,debug:{...entry.payload.debug,collectionCardSnapshot:true,timing:{meiliMs:readMs,totalMs:now()-started}}},'hit');
  }catch{return null;}
  };
  try{return await Promise.race([work(),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(null);},readBudgetMs);})]);}
  finally{clearTimeout(timer);controller.abort();}
 }
 async function begin({request,spec,preparedKey,rankingSession,attributes,collectionHandle,startedAt}){
  const key=collectionCardKey(request),shop=spec?.shop,collectionId=clean(spec?.collectionId);
  if(!key||spec?.retainForIdle!==true||!/^\d+$/.test(collectionId)||!sourceValid(shop,preparedKey))return null;
  try{
   const external=Boolean(spec.pinnedIds?.length||[...(spec.rule?.conditions||[]),...(spec.rule?.ruleGroups||[]).flatMap(g=>g.conditions||[])].some(c=>c.action==='Include'));
   const identity={shop,collectionId,preparedKey,external};
   const before=await readState(identity),prepared=current(before,external);
   if(Number.isFinite(before.scheduleChangedAt)&&before.scheduleChangedAt>(startedAt??0))return null;
   if(!prepared||before.configuration!==spec.revision||spec.orderRevision!=null&&before.orderRevision!==spec.orderRevision||sequenceSignature(prepared)!==sequenceSignature({...rankingSession,orderUpdatedAt:rankingSession.updatedAt}))return null;
   const state=stateSignature(before,external),sequence=sequenceSignature(prepared);
   return {async finish(payload,validationFingerprint){
    if(!validationFingerprint||!Array.isArray(payload.products)||payload.products.length>25||!Array.isArray(attributes))return;
    try{
     const after=await readState(identity),latest=current(after,external);
     if(!latest||stateSignature(after,external)!==state||sequenceSignature(latest)!==sequence)return;
     const {facets,rankingToken,...cards}=payload;
     const entry={version:1,...identity,configuration:spec.revision,state,sequence,sessionUpdatedAt:rankingSession.updatedAt??null,attributes,validationFingerprint,payload:cards,at:now()};
     const encoded=encodePreparation(entry);if(Buffer.byteLength(encoded)>Math.min(maxEntryBytes,maxBytes))return;
     const aliases=new Set([key]);
     const url=new URL(request.url);url.searchParams.delete('collectionHandle');url.searchParams.set('collectionId',collectionId);aliases.add(collectionCardKey(new Request(url)));
     if(collectionHandle){url.searchParams.delete('collectionId');url.searchParams.set('collectionHandle',collectionHandle);aliases.add(collectionCardKey(new Request(url)));}
     for(const alias of aliases)if(alias){
      if(typeof redis.eval==='function')await redis.eval(retain,3,`collectionFirstPage:${shop}:retention`,`collectionFirstPage:${shop}:sizes`,alias,lifetime,encoded,now(),maxEntries,maxBytes,`collectionFirstPage:${shop}:`);
      else await redis.setex(alias,lifetime,encoded);
     }
     return true;
    }catch{ /* Optional snapshots cannot prevent canonical card delivery. */ }
   }};
  }catch{return null;}
 }
 return {get,begin};
}
