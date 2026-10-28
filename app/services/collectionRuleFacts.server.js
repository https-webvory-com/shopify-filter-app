import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import prisma from '../db.server.js';
import redis from './redis.server.js';
import client from './meiliClient.server.js';
import {getCached} from './shopCache.server.js';
import {collectionRankingQueue} from './queue.server.js';
import {checkRuleMatch,applyMerchandisingRules,createMerchandisingComparator} from './merchandising.server.js';
import {prepareCollectionRanking} from '../utils/prepareCollectionRanking.js';
import {hydrateCollectionSkus,readRankedCollectionPage} from '../utils/rankedCollectionPage.js';
import {createCollectionFactProfile,isVariantCondition,collectionInputSource,projectCollectionRuleFacts} from '../utils/collectionRuleFacts.js';
import {createCollectionFactStore,readCollectionFactRecord} from '../utils/collectionFactStore.js';
import {maintainCollectionFacts} from '../utils/maintainCollectionFacts.js';
import {createCollectionCandidateIndex} from '../utils/collectionCandidateIndex.js';

const store=createCollectionFactStore(redis);
const hash=value=>createHash('sha256').update(value).digest('hex');
export function collectionFactsEnabled(shop){
 return Boolean(shop)&&process.env.CFP_COLLECTION_DIRECT_RANKING!=='false';
}
export async function getCollectionFactProfile(shop){
 return getCached(`collectionFactProfile:${shop}`,async()=>{
  const revision=String(await redis.get(`collectionPreparationRevision:${shop}`)||'0');
  const [rules,mergedValues]=await Promise.all([
   prisma.merchandisingRule.findMany({where:{shop,ruleType:'collection'},include:{conditions:true}}),
   getCached(`mergedValues:${shop}`,()=>prisma.mergedValue.findMany({where:{shop,isActive:true}})),
  ]);
  if(revision!==String(await redis.get(`collectionPreparationRevision:${shop}`)||'0'))throw Error('Collection configuration changed');
  return {...createCollectionFactProfile(rules.flatMap(rule=>rule.conditions||[]),mergedValues),revision};
 },600);
}

// New product data publishes its fact version before the index points at it.
// Optional fact-cache failures must not prevent the existing product update.
export async function withCollectionRuleFacts(documents){
 const profiles=new Map();
 for(const shop of new Set(documents.map(p=>p.shop)))if(collectionFactsEnabled(shop)){
  try{profiles.set(shop,await getCollectionFactProfile(shop));}catch(error){console.error('CFP: Collection fact profile unavailable:',error.name);}
 }
 const result=[];
 // Bound both temporary fact objects and network round trips during bulk sync.
 for(let offset=0;offset<documents.length;offset+=25){
  result.push(...await Promise.all(documents.slice(offset,offset+25).map(async p=>{
   if(!collectionFactsEnabled(p.shop))return p;
   const profile=profiles.get(p.shop);
   if(!profile?.conditions.length)return p;
   const source=collectionInputSource(p);
   let facts;
   if(profile)try{facts=projectCollectionRuleFacts(p,profile,checkRuleMatch);await store.put(p.shop,profile,p,facts);}
   catch(error){console.error('CFP: Collection fact write unavailable:',error.name);}
   // Keep optional index projections bounded for shops with many matching rules.
   const indexedFacts=facts&&Buffer.byteLength(JSON.stringify(facts))<=4096?facts:null;
   return {...p,...indexedFacts,cfpCollectionInputSource:source};
  })));
 }
 return result;
}

// This path reads projected rank inputs and freezes IDs; full variant documents
// are never scanned on a visitor request. The existing ranker remains fallback.
export async function prepareCollectionFromFacts(spec,{populate=false}={}){
 if(!collectionFactsEnabled(spec.shop)||(spec.retainForIdle!==true&&spec.directFiltered!==true)||
  !['best-selling','bestselling','price-ascending','price-descending','title-ascending','title-descending','created-ascending','created-descending'].includes(spec.sortBy))return null;
 if(spec.needsShopifyOrder&&!Array.isArray(spec.orderedIds))return null;
 const conditions=[...(spec.rule?.conditions||[]),...(spec.rule?.ruleGroups||[]).flatMap(g=>g.conditions||[])];
 const scalar=new Set(['Tags','Id','ID','id','Vendor','Product type','Product','Price','Available','Date','Rating']);
 if(conditions.some(c=>!scalar.has(c.field)&&!isVariantCondition(c)))return null;
 // Visitors retain their existing four-second budget. Only the single ranking
 // worker is allowed to populate missing shared inputs; each read stays bounded.
 const signal=populate?undefined:AbortSignal.timeout(4000),index=client.index('products');
 const work=(async()=>{
  const profile=conditions.some(isVariantCondition)?await getCollectionFactProfile(spec.shop):null;
  signal?.throwIfAborted();
  const candidates=createCollectionCandidateIndex(index,spec,{signal,browseConcurrency:populate?4:1});
  const boundedIndex={search:(q,options,extra={})=>candidates.search(q,options,{...extra,...(signal?{signal:extra.signal?AbortSignal.any([signal,extra.signal]):signal}:{})})};
  return prepareCollectionRanking(spec,{index:boundedIndex,prisma,arrange:applyMerchandisingRules,comparator:createMerchandisingComparator,captureReuse:true,
   ...(profile?{factProfile:profile,loadFacts:products=>populate?
    maintainCollectionFacts({store,index,prisma,shop:spec.shop,profile,products,check:checkRuleMatch}):
    store.load(spec.shop,profile,products,{signal})}:{})});
 })();
 let onAbort;
 try{return signal?await Promise.race([work,new Promise((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();})]):await work;}
 finally{if(onAbort)signal.removeEventListener('abort',onAbort);}
}

// Restart one deduplicated prerequisite sweep when upgrading from the old lane;
// an old lease must not strand its first page behind the catalog backlog.
const leaseKey=(shop,profile)=>`collectionFactSweepV2:${shop}:${profile}`;
const jobId=(shop,profile,offset)=>`collection-facts-${hash(shop+':'+profile)}-${offset}`;
async function enqueueFactPage(shop,profile,offset){
 const id=jobId(shop,profile,offset),previous=await collectionRankingQueue.getJob(id);
 if(previous&&['failed','completed'].includes(await previous.getState()))await previous.remove();
 if(previous&&['waiting','prioritized','delayed'].includes(await previous.getState())){
  if((previous.priority??previous.opts?.priority??10)>5)await previous.changePriority({priority:5});
  return previous;
 }
 return collectionRankingQueue.add('COLLECTION_FACTS_REFRESH',{shop,profile,offset},{jobId:id,priority:5});
}
export async function scheduleCollectionFactRefresh(shop){
 if(!collectionFactsEnabled(shop))return;
 const profile=await getCollectionFactProfile(shop);if(!profile.conditions.length)return;
 if(!await redis.set(leaseKey(shop,profile.id),'1','EX',600,'NX'))return;
 try{await enqueueFactPage(shop,profile.id,0);}
 catch(error){await redis.del(leaseKey(shop,profile.id));throw error;}
}

// Small prerequisite jobs run ahead of catalog builds, yielding to visitors.
// A sweep only reads full
// variant data for missing versions; it never rewrites product/index documents.
export async function processCollectionFactRefresh({shop,profile:expected,offset=0}){
 if(!collectionFactsEnabled(shop)||!await prisma.session.findFirst({where:{shop,isOnline:false},select:{id:true}}))return {skipped:true};
 const profile=await getCollectionFactProfile(shop);if(profile.id!==expected)return {superseded:true};
 await redis.expire(leaseKey(shop,profile.id),600);
 const index=client.index('products');
 const page=await index.getDocuments({filter:`shop = ${JSON.stringify(shop)} AND status = 'ACTIVE'`,fields:['id','shop','cfpCollectionInputSource'],limit:100,offset});
 const products=page.results||[];
 const bucket=`collectionRuleFacts:${shop}:${profile.id}`;
 const cached=products.length?await redis.hmget(bucket,...products.map(p=>p.id+':'+(p.cfpCollectionInputSource||'legacy'))):[];
 const known=new Set(profile.conditions.map(c=>c.key));
 const missing=products.filter((p,i)=>{try{readCollectionFactRecord(cached[i],p.cfpCollectionInputSource||'legacy',known);return false;}catch{return true;}});
 let published=0;
 for(let start=0;start<missing.length;start+=25){
  const ids=missing.slice(start,start+25).map(p=>p.id);
  const docs=await readRankedCollectionPage(index,{ids,page:1,limit:25,shop,attributes:['id','shop','status','variantPrices','options','images','cfpCollectionInputSource']});
  const eligible=docs.hits.filter(doc=>doc.shop===shop&&doc.status==='ACTIVE');
  const normalized=eligible.map(doc=>({...doc,id:'gid://shopify/Product/'+doc.id,variants:doc.variantPrices||[]}));
  if(profile.conditions.some(r=>r.condition.field==='SKU'))await hydrateCollectionSkus(normalized,prisma.variant,shop);
  const rows=eligible.map((doc,i)=>({product:doc,facts:projectCollectionRuleFacts(normalized[i],profile,checkRuleMatch,{backfill:true})}));
  published+=(await store.putMany(shop,profile,rows)).reduce((sum,value)=>sum+Number(value||0),0);
 }
 if(products.length===100){
  const next=offset+100;
  await enqueueFactPage(shop,profile.id,next);
 }else{
  // Product writes maintain versions continuously. Do not start another full
  // prerequisite sweep every minute and starve untouched catalog collections.
  await redis.set(leaseKey(shop,profile.id),'complete','EX',3600);
 }
 return {read:products.length,published,offset};
}
