import {createHash,randomUUID} from 'node:crypto';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean=value=>String(value).split('/').pop();
export const dependencyFallbackKey=shop=>`collectionExternalFallbackRevision:${shop}`;
export const dependencyAnyKey=shop=>`collectionExternalAnyRevision:${shop}`;
const counterKey=(shop,token)=>`collectionExternalInput:${shop}:${token}`;
const token=(type,value)=>type+hash(value);
function configuredPins(spec){
 let products=spec.pinningRule?.products;
 if(products==null)return [];
 if(typeof products==='string')try{products=JSON.parse(products);}catch{return null;}
 if(!Array.isArray(products))return null;
 return products.map(p=>p?.id).filter(Boolean);
}
export function collectionHasExternalCandidates(spec){
 const pins=configuredPins(spec);
 return pins===null||Boolean(pins.length||spec.pinnedIds?.length||[...(spec.rule?.conditions||[]),...(spec.rule?.ruleGroups||[]).flatMap(g=>g.conditions||[])].some(c=>c.action==='Include'));
}

// A union of exact Include tags and explicit pins covers both existing external
// members and products which can newly enter. Other predicates stay global.
export function describeCollectionDependencies(spec){
 const conditions=[...(spec.rule?.conditions||[]),...(spec.rule?.ruleGroups||[]).flatMap(g=>g.conditions||[])];
 const includes=conditions.filter(c=>c.action==='Include'),tokens=new Set();
 if(includes.length&&spec.rule?.collectionTagMatching!=='exact')return null;
 for(const c of includes){
  if(c.field!=='Tags'||typeof c.value!=='string'||!c.value.trim())return null;
  let value=c.value;
  if(/^[\[{]/.test(value)){
   try{const parsed=JSON.parse(value);if(!Array.isArray(parsed)||parsed.some(v=>typeof v!=='string'))return null;value=parsed.join(',');}catch{return null;}
  }
  for(const tag of value.split(',').map(v=>v.trim()).filter(Boolean))tokens.add(token('t',tag));
 }
 const configured=configuredPins(spec);if(configured===null)return null;
 for(const id of [...(spec.pinnedIds||[]),...configured]){const numeric=clean(id);if(!/^\d+$/.test(numeric))return null;tokens.add(token('p',numeric));}
 return tokens.size&&tokens.size<=512?{version:1,tokens:[...tokens].sort()}:null;
}
const valid=d=>d?.version===1&&Array.isArray(d.tokens)&&d.tokens.length>0&&d.tokens.length<=512&&
 d.tokens.every(t=>/^[tp][a-f0-9]{64}$/.test(t))&&new Set(d.tokens).size===d.tokens.length;
const initialize=`
for i=1,#KEYS do redis.call('SET',KEYS[i],ARGV[i],'NX') end
return redis.call('MGET',unpack(KEYS))`;

export function createCollectionDependencies(redis){
 async function revision(shop,descriptor,{initialize:initializeMissing=false}={}){
  if(!valid(descriptor))return null;
  const keys=[dependencyFallbackKey(shop),...descriptor.tokens.map(t=>counterKey(shop,t))];
  const read=()=>redis.mget?redis.mget(...keys):Promise.all(keys.map(k=>redis.get(k)));
  let values=await read();
  if(initializeMissing&&values.some(v=>v==null)){
   if(typeof redis.eval==='function')values=await redis.eval(initialize,keys.length,...keys,...keys.map(()=>randomUUID()));
   else{
    for(const key of keys)await redis.set(key,randomUUID(),'NX');
    values=await read();
   }
  }
  // Missing counters represent lost invalidation history and cannot prove reuse.
  if(values.some(v=>v==null))return null;
  return 'd1.'+hash([descriptor.tokens,values]);
 }
 async function changed(shop,proof){
  // Unknown dependency descriptions still need a safe, coarse proof. Exact
  // tag/pin descriptors retain their separate fine-grained counters below.
  await redis.set(dependencyAnyKey(shop),randomUUID());
  if(!proof||!Array.isArray(proof.tags)||!Array.isArray(proof.ids)||!proof.ids.length||proof.tags.length>2000||proof.ids.length>2000||
      proof.tags.some(t=>typeof t!=='string')||proof.ids.some(id=>!/^\d+$/.test(clean(id)))){
   await redis.set(dependencyFallbackKey(shop),randomUUID());return {precise:false};
  }
  const tokens=new Set([...proof.tags.map(t=>token('t',t)),...proof.ids.map(id=>token('p',clean(id)))]);
  // Counters never expire. Broad unknown/bulk changes advance the fallback.
  for(const t of tokens)await redis.set(counterKey(shop,t),randomUUID(),'XX');
  return {precise:true,tokens:tokens.size};
 }
 return {revision,changed,describe:describeCollectionDependencies};
}
