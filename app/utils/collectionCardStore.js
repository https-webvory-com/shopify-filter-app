import {hasUsableExtraFacets} from './extraProductFilters.js';
import {hasUsableSaleFacets} from './percentSaleFilter.js';
import {createHash} from 'node:crypto';
import {decodePreparation,encodePreparation} from './collectionPreparationPayload.js';
import {isPublicCollectionCards,collectionCardsResponse,acceptsCollectionPinnedPrefix,collectionCardPresentationVersion} from './collectionCards.js';
import {preparationFreshnessMs} from './collectionPreparation.js';
import {collectionHasExternalCandidates} from './collectionDependencies.js';
import {hasUsableProductTitleFacets} from './productTitleFilter.js';
import {hasUsableCollectionNavigation} from './collectionNavigation.js';

const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const clean=id=>String(id).split('/').pop();
export function collectionCardKey(request){
 if(!isPublicCollectionCards(request))return null;
 const url=new URL(request.url);url.searchParams.set('responseProfile','collection-cards-v1');url.searchParams.sort();
 return `collectionFirstPage:${url.searchParams.get('shop')}:${digest(url.pathname+'?'+url.searchParams)}`;
}
export function collectionCardSnapshotRequest(request){
 const url=new URL(request.url);
 if(new Set(url.searchParams.keys()).size!==[...url.searchParams.keys()].length)return null;
 if(['collection-v1','collection-v2'].includes(url.searchParams.get('responseProfile'))){
  // Called only after the canonical route has validated its ranking session.
  // All customer/filter/page restrictions still pass through the public gate.
  url.searchParams.delete('rankingToken');url.searchParams.set('responseProfile','collection-cards-v1');
 }
 const normalized=new Request(url,{method:request.method});
 return isPublicCollectionCards(normalized)?normalized:null;
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

// Working card snapshots verify documents and ranking epochs. Published serving
// versions are checked first and deliberately bypass this preparation work.
export function createCollectionCardStore({redis,readState,validateCards,createSession,loadDurable,saveDurable,publishedPages,observe=()=>{},now=Date.now,maxEntries=1024,maxBytes=24*1024*1024,maxEntryBytes=256*1024,lifetime=86400,readBudgetMs=500}){
 const sourceValid=(shop,key)=>typeof key==='string'&&key.startsWith(`collectionPreparedSequence:${shop}:background-v2:`)&&/^[a-f0-9]{64}$/.test(key.split(':').at(-1));
 const stateSignature=(state,external)=>JSON.stringify([state.configuration,state.products,external?(state.externalProducts??state.globalProducts):null,state.hardAll,state.hardCollection,state.orderRevision,state.scheduleEpoch,state.runtimeGeneration,state.epochsPresent,...(state.salesProducts!==undefined?[state.salesProducts]:[])]);
 const sequenceSignature=value=>digest([value.ids,value.metadata]);
 function current(state,external){
  if(!state?.preparedRaw||state.epochsPresent===false||typeof state.orderRevision!=='string'||!state.orderRevision)return null;
  let prepared;try{prepared=decodePreparation(state.preparedRaw);}catch{return null;}
  if(!Array.isArray(prepared?.ids)||!prepared.metadata||!Number.isFinite(prepared.preparedAt)||prepared.preparedAt>now())return null;
  // Old outside-Include/pin snapshots must pass the canonical one-time
  // adoption/build before receiving indefinite event-driven retention.
  if(external&&prepared.rankingEventsVersion!==1)return null;
  if(external&&prepared.externalDependencies&&typeof state.externalProducts!=='string')return null;
  if(prepared.productRevisionSource==='content-v1'){
   if(!prepared.salesDependencies||typeof state.salesProducts!=='string')return null;
  }else if(state.salesEpoch?.startsWith('e.'))return null;
  const epochs=typeof prepared.reusableDataRevision==='string'?prepared.reusableDataRevision.split(':'):[];
  if(epochs[0]!==state.hardAll||epochs[1]!==state.hardCollection)return null;
  const productsChanged=prepared.productRevision!==state.products||external&&epochs[2]!==(state.externalProducts??state.globalProducts)||prepared.salesDependencies&&prepared.salesDependencies.revision!==state.salesProducts;
  // Match the canonical ranker's existing bounded reuse policy. A soft product
  // update does not change this saved sequence immediately; the exact cards
  // being returned are independently checked against current documents below.
  if(productsChanged&&now()-prepared.preparedAt>=preparationFreshnessMs)return null;
  return prepared;
 }
 const compatibleState=(entry,state)=>{
  let saved;try{saved=JSON.parse(entry.state);}catch{return false;}
  const current=JSON.parse(stateSignature(state,entry.external));
  if(!Array.isArray(saved)||saved.length!==current.length)return false;
  current[1]=saved[1];current[2]=saved[2];
  if(current.length===10)current[9]=saved[9];
  return JSON.stringify(current)===entry.state;
 };
 async function get(request,{probe=false,onHit}={}){
  if(!probe&&publishedPages){const published=await publishedPages.get(request,{onHit});if(published)return published;}
  const key=collectionCardKey(request);if(!key)return null;
  const controller=new AbortController(),started=now();let timer,stage='snapshot',outcome;
  const work=async()=>{
  try{
   const shop=new URL(request.url).searchParams.get('shop');
   let raw=await redis.get(key);
   if(raw?.startsWith('p1:')){
    const target=raw.slice(3),prefix=`collectionFirstPage:${shop}:`;
    if(!target.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(target.slice(prefix.length)))return null;
    raw=await redis.get(target);
   }
   controller.signal.throwIfAborted();
   if(!raw&&loadDurable)raw=await loadDurable({shop,kind:'cards',key});
   let entry;try{entry=decodePreparation(raw);}catch{return null;}
   controller.signal.throwIfAborted();
   if(entry?.version!==1||entry.policyVersion!==2||entry.cardPresentationVersion!==collectionCardPresentationVersion||entry.shop!==shop||!/^\d+$/.test(entry.collectionId)||!sourceValid(shop,entry.preparedKey)||!Array.isArray(entry.attributes)||!entry.validationFingerprint||!entry.payload?.products||!Number.isFinite(entry.at)||now()-entry.at>=lifetime*1000)return null;
   if(!hasUsableExtraFacets(entry.payload))return null;
   if(!hasUsableSaleFacets(entry.payload))return null;
   if(!hasUsableProductTitleFacets(entry.payload))return null;
   if(!hasUsableCollectionNavigation(entry.payload))return null;
   stage='ranking-state';const before=await readState(entry),prepared=current(before,entry.external);
   controller.signal.throwIfAborted();
   if(!prepared||before.configuration!==entry.configuration||!compatibleState(entry,before)||sequenceSignature(prepared)!==entry.sequence)return null;
   let previewLimit=Number(new URL(request.url).searchParams.get('limit'));
   stage='current-documents';const readStarted=now();if(!await validateCards(entry,prepared,{request,preview:new URL(request.url).searchParams.get('responseProfile')==='collection-preview-v1'&&!acceptsCollectionPinnedPrefix(request),onValidated:count=>{previewLimit=count;}}))return null;
   const readMs=now()-readStarted;controller.signal.throwIfAborted();
   stage='session';const session=probe?{}:await createSession(request,entry,prepared);
   stage='final-state';
   const after=await readState(entry),afterPrepared=current(after,entry.external);
   controller.signal.throwIfAborted();
   if(!afterPrepared||stateSignature(after,entry.external)!==stateSignature(before,entry.external)||sequenceSignature(afterPrepared)!==entry.sequence)return null;
   // Do not make ready cards wait for optional queue/registry work. Trusted
   // background probes must not masquerade as shopper visits or enqueue loops.
   if(!probe&&onHit)Promise.resolve().then(()=>onHit({request,entry,prepared:afterPrepared,state:after})).catch(()=>{});
   let payload=entry.payload;
   // Soft updates can retain unchanged cards, but collection-wide counts must
   // match all saved product epochs, including products outside this page.
   if(payload.cfpCards?.facetsReady&&entry.state!==stateSignature(after,entry.external)){
    const {facets,...cards}=payload;payload={...cards,cfpCards:{...cards.cfpCards,facetsReady:false}};
   }
   return collectionCardsResponse({...payload,rankingToken:session.token,debug:{...payload.debug,collectionCardSnapshot:true,timing:{meiliMs:readMs,totalMs:now()-started}}},'hit',request,{previewLimit});
  }catch{return null;}
  };
  try{outcome=await Promise.race([work(),new Promise(resolve=>{timer=setTimeout(()=>{stage='timeout:'+stage;controller.abort();resolve(null);},readBudgetMs);})]);return outcome;}
  finally{clearTimeout(timer);controller.abort();try{observe({event:outcome?'cards-ready':'cards-unavailable',reason:outcome?undefined:stage,shop:new URL(request.url).searchParams.get('shop'),readMs:now()-started});}catch{}}
 }
 async function begin({request,spec,preparedKey,rankingSession,attributes,collectionHandle,startedAt}){
  request=collectionCardSnapshotRequest(request);if(!request)return null;
  let retainedEntry;
  // A token-scoped facet follow-up already has its immutable ranking session.
  // Upgrade its saved card entry without rebuilding the preparation spec.
  if(!spec&&rankingSession)try{
   const shop=new URL(request.url).searchParams.get('shop');
   let raw=await redis.get(collectionCardKey(request));
   if(raw?.startsWith('p1:')){
    const target=raw.slice(3),prefix=`collectionFirstPage:${shop}:`;
    if(!target.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(target.slice(prefix.length)))return null;
    raw=await redis.get(target);
   }
   if(!raw&&loadDurable)raw=await loadDurable({shop,kind:'cards',key:collectionCardKey(request)});
   retainedEntry=decodePreparation(raw);
   if(retainedEntry?.version!==1||retainedEntry.policyVersion!==2||retainedEntry.cardPresentationVersion!==collectionCardPresentationVersion||retainedEntry.shop!==shop)return null;
   spec={shop,collectionId:retainedEntry.collectionId,revision:retainedEntry.configuration,retainForIdle:true};
   preparedKey=retainedEntry.preparedKey;
  }catch{return null;}
  const key=collectionCardKey(request),shop=spec?.shop,collectionId=clean(spec?.collectionId);
  if(!key||spec?.retainForIdle!==true||!/^\d+$/.test(collectionId)||!sourceValid(shop,preparedKey))return null;
  try{
   const external=retainedEntry?.external??collectionHasExternalCandidates(spec);
   const identity={shop,collectionId,preparedKey,external};
   const before=await readState(identity),prepared=current(before,external);
   if(retainedEntry&&!compatibleState(retainedEntry,before))return null;
   if(Number.isFinite(before.scheduleChangedAt)&&before.scheduleChangedAt>(startedAt??0))return null;
   if(!prepared||before.configuration!==spec.revision||spec.orderRevision!=null&&before.orderRevision!==spec.orderRevision||sequenceSignature(prepared)!==sequenceSignature({...rankingSession,orderUpdatedAt:rankingSession.updatedAt}))return null;
   const state=stateSignature(before,external),sequence=sequenceSignature(prepared);
   return {async finish(payload,validationFingerprint,previewValidationFingerprint,{facetsReady=false}={}){
    const pageSize=Number(new URL(request.url).searchParams.get('limit'));
    if(!validationFingerprint||!Array.isArray(payload.products)||payload.products.length>pageSize||!Array.isArray(attributes))return;
    try{
     const after=await readState(identity),latest=current(after,external);
     if(!latest||stateSignature(after,external)!==state||sequenceSignature(latest)!==sequence)return;
     const {facets,rankingToken,...cards}=payload;
     if(facetsReady&&facets&&Array.isArray(cards.settings)){
      cards.facets=facets;cards.cfpCards={version:1,facetsReady:true};
     }
     const entry={version:1,policyVersion:2,cardPresentationVersion:collectionCardPresentationVersion,...identity,configuration:spec.revision,marketAvailabilityRevision:spec.marketAvailabilityRevision,state,sequence,sessionUpdatedAt:rankingSession.updatedAt??null,attributes,validationFingerprint,
      ...(typeof previewValidationFingerprint==='string'?{previewValidationFingerprint}:{}),payload:cards,at:now()};
     const encoded=encodePreparation(entry);if(Buffer.byteLength(encoded)>Math.min(maxEntryBytes,maxBytes))return;
     const aliases=new Set([key]);
     const url=new URL(request.url);url.searchParams.delete('collectionHandle');url.searchParams.set('collectionId',collectionId);aliases.add(collectionCardKey(new Request(url)));
     const canonical=collectionCardKey(new Request(url));
     if(collectionHandle){url.searchParams.delete('collectionId');url.searchParams.set('collectionHandle',collectionHandle);aliases.add(collectionCardKey(new Request(url)));}
     // Persist one payload per collection/market. Handle aliases are small
     // pointers, not another complete copy of every variant and image.
     const saveCards=async()=>{if(saveDurable)try{await saveDurable({shop,kind:'cards',key:canonical,aliases:[...aliases].filter(Boolean),collectionId,payload:encoded,validatedAt:entry.at,expiresAt:entry.at+lifetime*1000});}catch{}};
     if(pageSize!==50)await saveCards();
     const finalState=await readState(identity),finalPrepared=current(finalState,external);
     if(!finalPrepared||stateSignature(finalState,external)!==state||sequenceSignature(finalPrepared)!==sequence)return;
     if(pageSize===50&&publishedPages){
      if(!await publishedPages.publish({request,collectionId,collectionHandle,prepared:finalPrepared,payload,configuration:spec.revision,marketAvailabilityRevision:spec.marketAvailabilityRevision,at:startedAt??entry.at,sessionUpdatedAt:rankingSession.updatedAt??null}))return false;
     }
     if(pageSize===50)await saveCards();
     for(const alias of aliases)if(alias){
      const value=alias===canonical?encoded:'p1:'+canonical;
      if(typeof redis.eval==='function')await redis.eval(retain,3,`collectionFirstPage:${shop}:retention`,`collectionFirstPage:${shop}:sizes`,alias,lifetime,value,now(),maxEntries,maxBytes,`collectionFirstPage:${shop}:`);
      else await redis.setex(alias,lifetime,value);
     }
     return true;
    }catch{ /* Optional snapshots cannot prevent canonical card delivery. */ }
   }};
  }catch{return null;}
 }
 return {get,begin};
}
