import {createHash} from 'node:crypto';
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
import configuredWarmups from '../config/collection-prewarm.json';

const store=createCollectionFactStore(redis);
const hash=value=>createHash('sha256').update(value).digest('hex');
export function collectionFactsEnabled(shop){
 if(process.env.CFP_COLLECTION_DIRECT_RANKING==='false')return false;
 const shops=process.env.CFP_COLLECTION_DIRECT_SHOPS?.split(',').map(s=>s.trim())||configuredWarmups.map(r=>r.shop);
 return shops.includes(shop);
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
   const source=collectionInputSource(p),profile=profiles.get(p.shop);
   if(profile)try{await store.put(p.shop,profile,p,projectCollectionRuleFacts(p,profile,checkRuleMatch));}
   catch(error){console.error('CFP: Collection fact write unavailable:',error.name);}
   return {...p,cfpCollectionInputSource:source};
  })));
 }
 return result;
}

// This path reads projected rank inputs and freezes IDs; full variant documents
// are never scanned on a visitor request. The existing ranker remains fallback.
export async function prepareCollectionFromFacts(spec){
 if(!collectionFactsEnabled(spec.shop)||spec.retainForIdle!==true||
  !['best-selling','bestselling','price-ascending','price-descending','title-ascending','title-descending','created-ascending','created-descending'].includes(spec.sortBy))return null;
 if(['best-selling','bestselling'].includes(spec.sortBy)&&(!spec.needsShopifyOrder||!Array.isArray(spec.orderedIds)))return null;
 const conditions=[...(spec.rule?.conditions||[]),...(spec.rule?.ruleGroups||[]).flatMap(g=>g.conditions||[])];
 const scalar=new Set(['Tags','Id','ID','id','Vendor','Product type','Product','Price','Available','Date','Rating']);
 if(conditions.some(c=>!scalar.has(c.field)&&!isVariantCondition(c)))return null;
 const signal=AbortSignal.timeout(4000),index=client.index('products');
 const work=(async()=>{
  const profile=conditions.some(isVariantCondition)?await getCollectionFactProfile(spec.shop):null;
  signal.throwIfAborted();
  const boundedIndex={search:(q,options,extra={})=>index.search(q,options,{...extra,signal:extra.signal?AbortSignal.any([signal,extra.signal]):signal})};
  return prepareCollectionRanking(spec,{index:boundedIndex,prisma,arrange:applyMerchandisingRules,comparator:createMerchandisingComparator,
   ...(profile?{factProfile:profile,loadFacts:products=>store.load(spec.shop,profile,products,{signal})}:{})});
 })();
 let onAbort;
 try{return await Promise.race([work,new Promise((_,reject)=>{onAbort=()=>reject(signal.reason);signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)onAbort();})]);}
 finally{signal.removeEventListener('abort',onAbort);}
}

const leaseKey=(shop,profile)=>`collectionFactSweep:${shop}:${profile}`;
const jobId=(shop,profile,offset)=>`collection-facts-${hash(shop+':'+profile)}-${offset}`;
async function enqueueFactPage(shop,profile,offset){
 const id=jobId(shop,profile,offset),previous=await collectionRankingQueue.getJob(id);
 if(previous&&['failed','completed'].includes(await previous.getState()))await previous.remove();
 return collectionRankingQueue.add('COLLECTION_FACTS_REFRESH',{shop,profile,offset},{jobId:id,priority:10});
}
export async function scheduleCollectionFactRefresh(shop){
 if(!collectionFactsEnabled(shop))return;
 const profile=await getCollectionFactProfile(shop);if(!profile.conditions.length)return;
 if(!await redis.set(leaseKey(shop,profile.id),'1','EX',600,'NX'))return;
 try{await enqueueFactPage(shop,profile.id,0);}
 catch(error){await redis.del(leaseKey(shop,profile.id));throw error;}
}

// Small jobs share background priority 10 and yield to visitor priority 1.
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
  for(let i=0;i<eligible.length;i++){
   const doc=eligible[i],product=normalized[i];
   published+=Number(await store.put(shop,profile,doc,projectCollectionRuleFacts(product,profile,checkRuleMatch,{backfill:true}))||0);
  }
 }
 if(products.length===100){
  const next=offset+100;
  await enqueueFactPage(shop,profile.id,next);
 }else await redis.del(leaseKey(shop,profile.id));
 return {read:products.length,published,offset};
}
