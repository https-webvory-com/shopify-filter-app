import redis from './redis.server.js';
import { collectionRankingQueue } from './queue.server.js';
import prisma from '../db.server.js';
import meiliClient from './meiliClient.server.js';
import { applyMerchandisingRules, createMerchandisingComparator } from './merchandising.server.js';
import { prepareCollectionRanking } from '../utils/prepareCollectionRanking.js';
import { createCollectionPreparation, warmupContextsKey, warmupShopsKey, publicPreparationLimit, warmupRegistryLifetime, normalizeCollectionWarmup } from '../utils/collectionPreparation.js';
import {createHash} from 'node:crypto';
import {collectionOrderSnapshotKey, getCollectionBestSellingState} from './collectionBestSelling.server.js';
import configuredWarmups from '../config/collection-prewarm.json' with {type:'json'};
import {prepareCollectionFromFacts,scheduleCollectionFactRefresh} from './collectionRuleFacts.server.js';
import {validateCollectionReuse} from '../utils/validateCollectionReuse.js';
import {loadCollectionLoadingSnapshot,saveCollectionLoadingSnapshot} from './collectionLoadingSnapshots.server.js';
import {createCollectionVisitorRefresh} from '../utils/collectionVisitorRefresh.js';
import {createCollectionWarmupScheduler} from '../utils/collectionWarmupScheduler.js';
import {createCollectionDependencies} from '../utils/collectionDependencies.js';
import {createCollectionPreparationTelemetry} from '../utils/collectionPreparationTelemetry.js';
import {getPreparedCollectionCards} from './collectionCards.server.js';
import {publishedCollectionKey} from '../utils/collectionPublishedPage.js';
import {getMarketAvailabilityState} from './marketAvailability.server.js';
import {createCollectionSalesDependencies} from '../utils/collectionSalesDependencies.js';
import {preparationKey} from '../utils/collectionPreparation.js';
import {createCollectionHeadProofs} from '../utils/collectionHeadProofs.js';
import {activePinsInSavedOrder,isSafeCollectionPinEdit} from '../utils/collectionPinReorder.js';
import {catalogPublicationInvalidatedAtKey,configurationInvalidatedAtKey,marketRuleInvalidatedAtKey} from '../utils/shopCacheInvalidation.js';
const recordPreparationEvent=createCollectionPreparationTelemetry(redis);
async function readCollectionHeadVersion(spec){
  const shop=spec.shop,id=String(spec.collectionId).split('/').pop();
  // Read input metadata only. A head must never load or decode a complete
  // saved ranking just to prove that explicit pins are still current.
  const [values,schedules]=await Promise.all([
    redis.mget(`collectionPreparationRevision:${shop}`,`collectionRankingDataRevision:${shop}:all`,`collectionRankingDataRevision:${shop}:${id}`,`collectionLoadingGeneration:${shop}`,`collectionProductContentRevision:${shop}:all`,`collectionProductContentRevision:${shop}:${id}`,`collectionOrderSnapshot:${shop}:gid://shopify/Collection/${id}`),
    prisma.merchandisingRule.findMany({where:{shop,status:true,ruleType:'collection',OR:[{startDate:{not:null}},{endDate:{not:null}}]},select:{id:true,startDate:true,endDate:true},orderBy:{id:'asc'}}),
  ]);
  let order;if(spec.needsShopifyOrder&&values[6]!=null)try{order=JSON.parse(values[6]);}catch{return null;}
  if(!values[3]||String(values[0]??'0')!==spec.revision||
    spec.needsShopifyOrder&&(order?.revision??null)!==(spec.orderRevision??null))return null;
  const time=Date.now(),schedule=schedules.map(rule=>{const start=rule.startDate==null?null:new Date(rule.startDate).getTime(),end=rule.endDate==null?null:new Date(rule.endDate).getTime();return [rule.id,start,end,(start==null||time>=start)&&(end==null||time<=end)];});
  const counters=values.slice(0,6).map((value,index)=>index===3?value:String(value??'0'));
  return createHash('sha256').update(JSON.stringify([1,preparationKey(spec),...counters,order?.revision??null,schedule])).digest('hex');
}
const headProofs=createCollectionHeadProofs({redis,readVersion:readCollectionHeadVersion,observe:event=>{
  (event.event==='head-comparison-mismatch'?console.error:console.info)('CFP: collection head',JSON.stringify(event));recordPreparationEvent(event).catch(()=>{});
}});
const pinTransitionKey=(shop,revision,ruleId)=>`collectionPinReorder:${shop}:${revision}:${ruleId}`;
export async function rememberCollectionPinReorder(shop,before,after,oldRevision,newRevision){
  if(!isSafeCollectionPinEdit(before,after)||oldRevision===newRevision)return false;
  try{
    await redis.setex(pinTransitionKey(shop,newRevision,after.id),600,JSON.stringify({oldRevision,before}));
    return true;
  }catch{return false;}
}
export async function rememberCollectionPinCreation(shop,rule,oldRevision,newRevision){
  if(!rule?.id||rule.ruleType!=='collection'||rule.status!==true||oldRevision===newRevision)return false;
  try{
    await redis.setex(pinTransitionKey(shop,newRevision,rule.id),600,JSON.stringify({oldRevision,before:null}));
    return true;
  }catch{return false;}
}
async function readPinReorderSource(spec){
  if(spec.retainForIdle!==true||spec.needsShopifyOrder!==true||
      !['best-selling','bestselling'].includes(spec.sortBy)||!spec.pinningRule?.id)return null;
  let transition;try{transition=JSON.parse(await redis.get(pinTransitionKey(spec.shop,spec.revision,spec.pinningRule.id)));}catch{return null;}
  if(!transition||transition.before && !isSafeCollectionPinEdit(transition.before,spec.pinningRule))return null;
  if(transition.before===null){
    if(!Array.isArray(spec.pinnedIds)||!spec.pinnedIds.length)return null;
    return {...spec,revision:transition.oldRevision,pinningRule:null,pinnedIds:[]};
  }
  const pinnedIds=activePinsInSavedOrder(transition.before,spec.pinnedIds);
  if(!pinnedIds||pinnedIds.length!==spec.pinnedIds.length)return null;
  return {...spec,revision:transition.oldRevision,pinningRule:transition.before,pinnedIds};
}
async function verifyNewPins(spec,pinIds){
  if(!pinIds.length||pinIds.length>250)return false;
  const ids=[...new Set(pinIds.map(value=>String(value).split('/').pop()))];
  if(ids.length!==pinIds.length||ids.some(value=>!/^\d+$/.test(value)))return false;
  try{
    const [products,documents]=await Promise.all([
      prisma.product.findMany({where:{shop:spec.shop,id:{in:pinIds}},select:{id:true,priceMin:true,status:true}}),
      meiliClient.index('products').getDocuments({filter:`id IN ${JSON.stringify(ids)}`,fields:['id','shop','priceMin','status'],limit:ids.length,offset:0}),
    ]);
    if(products.length!==ids.length||documents?.results?.length!==ids.length)return false;
    const positive=row=>row&&Number.isFinite(Number(row.priceMin))&&Number(row.priceMin)>0&&String(row.status||'active').toLowerCase()==='active';
    const productById=new Map(products.map(row=>[String(row.id).split('/').pop(),row]));
    const documentById=new Map(documents.results.map(row=>[String(row.id).split('/').pop(),row]));
    return ids.every(id=>positive(productById.get(id))&&positive(documentById.get(id))&&documentById.get(id).shop===spec.shop);
  }catch{return false;}
}
export async function getCollectionHeadVersion(spec){const version=await readCollectionHeadVersion(spec);return version&&!await headProofs.blocked(spec,version)?version:null;}
export const rememberCollectionHead=headProofs.remember;
export const compareCollectionHead=headProofs.compare;
export function reportCollectionHead(spec,path,reason){
  const event={event:'head-'+path,reason,shop:spec.shop,collectionId:spec.collectionId};
  console.info('CFP: collection head',JSON.stringify(event));recordPreparationEvent(event).catch(()=>{});
}

// Explicit public contexts can be prepared before the first visitor. These are
// operational priorities, not ranking rules. Recent visitor replay remains bounded.
function seededWarmups(shop) {
  const records=[];
  for (const entry of configuredWarmups) {
    if (entry.shop!==shop || !entry.country || !entry.locale || !entry.collectionHandle || entry.collectionHandle==='search') continue;
    const url=new URL('https://ranking.internal/api/filter');
    for (const key of ['shop','country','locale','collectionHandle','sortBy']) if(entry[key])url.searchParams.set(key,entry[key]);
    url.searchParams.set('page','1');
    const record=normalizeCollectionWarmup(shop,url);
    if(record && !records.some(r=>r.url===record.url))records.push(record);
    if(records.length===publicPreparationLimit)break;
  }
  return records;
}

const preparation = createCollectionPreparation({ redis, queue: collectionRankingQueue, prepare: async spec =>{
  const value=(spec.allowIncompleteMarketPrice?null:await prepareCollectionFromFacts(spec,{populate:true}).catch(()=>null)) ||
    await prepareCollectionRanking(spec, { index: meiliClient.index('products'), prisma, arrange: applyMerchandisingRules, comparator:createMerchandisingComparator,captureReuse:true });
  await compareCollectionHead(spec,value);return value;
},
  prepareDirect:spec=>spec.allowIncompleteMarketPrice?null:prepareCollectionFromFacts(spec),dependencies:createCollectionDependencies(redis),scores:createCollectionSalesDependencies(redis),
  loadDurable:loadCollectionLoadingSnapshot,saveDurable:saveCollectionLoadingSnapshot,
  validateReuse:(spec,value)=>validateCollectionReuse(meiliClient.index('products'),spec,value),
  revalidateSaved:true,readPinReorderSource,verifyNewPins,
  observe:event=>{console.info('CFP: collection preparation',JSON.stringify({...event,at:Date.now()}));recordPreparationEvent(event).catch(()=>{});},
});
const publicParameters = new Set(['shop', 'locale', 'language', 'country', 'collectionHandle', 'collectionId', 'sortBy', 'page', 'limit', 'responseProfile']);

export const getCollectionPreparationRevision = preparation.revision;
export const getPreparedCollectionRanking = preparation.get;
export const processCollectionPreparation = preparation.process;
export const discardPreparedCollectionRanking = preparation.discard;
export const registerCollectionCardVisit=createCollectionVisitorRefresh({queue:collectionRankingQueue,register:registerCollectionWarmup});

// Remember only anonymous, unfiltered first pages. Customer targeting and
// filtered requests remain separately scoped and are never replayed as public.
export async function registerCollectionWarmup(shop, requestUrl, collectionId) {
  const record=normalizeCollectionWarmup(shop,requestUrl,collectionId);
  if (!record) return;
  const key = warmupContextsKey(shop);
  await redis.zadd(key, Date.now(), JSON.stringify(record));
  const capacity=publicPreparationLimit-seededWarmups(shop).length;
  await redis.zremrangebyrank(key, 0, -capacity-1);
  await redis.expire(key, warmupRegistryLifetime);
  await redis.zadd(warmupShopsKey, Date.now(), shop);
  await redis.zremrangebyscore(warmupShopsKey, '-inf', Date.now() - warmupRegistryLifetime*1000);
}

// Refresh known public contexts even when no browser is currently visiting.
// This only schedules deduplicated, low-priority jobs.
let discoveredRegistries = false;
const orderDiscoveryAt = new Map();
const coverageAuditAt = new Map();
const coverageAuditStartedAt=Date.now();
async function primaryShopMarket(shop){
  const key=`collectionPrimaryMarket:${shop}`;
  try{
    const cached=await redis.get(key);
    if(cached)return JSON.parse(cached);
  }catch{}
  let market=null;
  try{
    const {unauthenticated}=await import('../shopify.server.js');
    const {admin}=await unauthenticated.admin(shop);
    const response=await admin.graphql('query CollectionPrimaryMarket { shop { shopAddress { countryCodeV2 } } }');
    const body=await response.json();
    if(response.ok&&!body.errors?.length){
      const country=body.data?.shop?.shopAddress?.countryCodeV2;
      if(/^[A-Z]{2}$/.test(country||''))market={country,locale:'en'};
    }
  }catch(error){console.error('CFP: Primary collection market unavailable:',error.name);}
  try{await redis.setex(key,market?21600:1800,JSON.stringify(market));}catch{}
  return market;
}
// Seed order snapshots for collections before their first storefront visit.
// Existing snapshots are left alone; their normal refresh policy still applies.
// Page discovery and queue submissions are bounded, and cold visitors promote
// these same deduplicated jobs above the background backlog.
export async function scheduleMissingCollectionOrders(shop) {
  let cursor;
  for (;;) {
    const collections = await prisma.collection.findMany({
      where: {shop}, select: {id:true}, orderBy: {id:'asc'}, take:100,
      ...(cursor ? {cursor:{id:cursor},skip:1} : {}),
    });
    if (!collections.length) return;
    const snapshots = await redis.mget(...collections.map(collection => collectionOrderSnapshotKey(shop,collection.id)));
    for (let i=0;i<collections.length;i++) {
      if (!snapshots[i]) await getCollectionBestSellingState(shop,collections[i].id,{warmup:true});
    }
    if (collections.length<100) return;
    cursor=collections.at(-1).id;
  }
}

// Discover public markets from configuration and real public visits. Never turn
// customer tags, filters, arbitrary URLs or transport versions into catalog jobs.
export async function scheduleCatalogCollectionWarmups(shop, collectionIds=null, priority=10, countryContext=null, forceMissing=false, validatePublished=false) {
  const records=[...seededWarmups(shop),...(await redis.zrange(warmupContextsKey(shop),-publicPreparationLimit,-1)).flatMap(value=>{
    try{return [JSON.parse(value)];}catch{return [];}
  })];
  const markets=new Map();
  let connectedCountries=null;
  if(!countryContext)try{
    const connection=await prisma.marketStorefrontConnection.findUnique({where:{shop},select:{countries:true,locale:true}});
    if(connection)connectedCountries=new Set(connection.countries||[]);
    if(connection)for(const country of connection.countries||[]){
      if(!/^[A-Z]{2}$/.test(country))continue;
      const url=new URL('https://ranking.internal/api/filter');
      for(const [key,value]of Object.entries({shop,country,locale:connection.locale||'en',sortBy:'best-selling',page:'1'}))url.searchParams.set(key,value);
      markets.set(url.search,url);
    }
  }catch(error){console.error('CFP: Enabled collection markets unavailable:',error.name);}
  if(countryContext)for(const country of countryContext.countries){
    if(!/^[A-Z]{2}$/.test(country))continue;
    const url=new URL('https://ranking.internal/api/filter');
    for(const [key,value]of Object.entries({shop,country,locale:countryContext.locale,sortBy:'best-selling',page:'1'}))url.searchParams.set(key,value);
    markets.set(url.search,url);
  }
  for(const record of records){
    if(countryContext)break;
    const normalized=normalizeCollectionWarmup(shop,record.url,record.collectionId);
    if(!normalized)continue;
    const source=new URL(normalized.url),url=new URL('https://ranking.internal/api/filter');
    if(connectedCountries&&!connectedCountries.has(source.searchParams.get('country')))continue;
    url.searchParams.set('shop',shop);
    for(const key of ['country','locale','language'])if(source.searchParams.has(key))url.searchParams.set(key,source.searchParams.get(key));
    url.searchParams.set('sortBy','best-selling');url.searchParams.set('page','1');
    // Replay only validated public contexts, but never discard an observed
    // market merely because another market was visited more recently.
    if(!markets.has(url.search))markets.set(url.search,url);
  }
  // An observed secondary market must not suppress the store's primary market.
  // Unconnected stores do not have an authoritative enabled-country list.
  if(!countryContext&&!connectedCountries){
    const market=await primaryShopMarket(shop);
    if(market){
      const url=new URL('https://ranking.internal/api/filter');
      for(const [key,value]of Object.entries({shop,...market,sortBy:'best-selling',page:'1'}))url.searchParams.set(key,value);
      if(!markets.has(url.search))markets.set(url.search,url);
    }
  }
  if(!markets.size)return;
  // A complete published first page is the actual visitor-ready unit. Give
  // uncovered contexts precedence over routine refreshes of ready pages.
  let publishedAliases=null,configurationInvalidatedAt=0;
  try{
    if(!forceMissing){
      const [rows,invalidatedAt]=await Promise.all([
        prisma.collectionLoadingSnapshot.findMany({where:{shop,kind:'published',expiresAt:{gt:new Date()}},select:{aliases:true,validatedAt:true}}),
        redis.get(configurationInvalidatedAtKey(shop)),
      ]);
      configurationInvalidatedAt=Number(invalidatedAt)||0;
      publishedAliases=new Map();
      for(const row of rows)for(const alias of row.aliases||[]){
        const at=row.validatedAt instanceof Date?row.validatedAt.getTime():0;
        publishedAliases.set(alias,Math.max(publishedAliases.get(alias)||0,at));
      }
    }
  }catch(error){console.error('CFP: Collection publication coverage unavailable:',error.name);}
  let present=0,missing=0;
  const marketVersions=new Map();
  const publicationPriority=async(url,scopedInvalidatedAt=0)=>{
    if(forceMissing)return priority;
    const page=new URL(url);page.searchParams.set('responseProfile','collection-preview-v1');page.searchParams.set('limit','25');
    const key=publishedCollectionKey(new Request(page));
    if(!publishedAliases||!key)return priority;
    const at=publishedAliases.get(key)||0;
    if(at&&at>configurationInvalidatedAt&&at>scopedInvalidatedAt){
      if(!validatePublished){present++;return priority;}
      try{
        const country=page.searchParams.get('country');
        if(!marketVersions.has(country))marketVersions.set(country,await getMarketAvailabilityState(shop,country));
        const market=marketVersions.get(country);
        const readyUrl=new URL(page);readyUrl.searchParams.set('responseProfile','collection-cards-v1');readyUrl.searchParams.set('limit','50');
        const ready=market.status==='pending'?null:await getPreparedCollectionCards(new Request(readyUrl),{probe:true,publishedOnly:true,marketAvailabilityVersion:market.version});
        if(ready?.status===200&&ready.headers?.get('X-CFP-Collection-Cards')==='published'){present++;return priority;}
      }catch{/* A failed proof must be rebuilt, never counted as covered. */}
    }
    missing++;return Math.min(priority,2);
  };
  const scopes=collectionIds?.map(id=>String(id).split('/').pop()).filter(id=>/^\d+$/.test(id));
  // The virtual All products page has no Shopify Collection row to discover.
  if(!collectionIds||collectionIds.includes('all'))for(const market of markets.values()){
    const url=new URL(market);url.searchParams.delete('collectionId');url.searchParams.set('collectionHandle','all');
    const record=normalizeCollectionWarmup(shop,url);if(!record)continue;
    const marker=Math.max(Number(await redis.get(catalogPublicationInvalidatedAtKey(shop,'all')))||0,Number(await redis.get(marketRuleInvalidatedAtKey(shop,url.searchParams.get('country'))))||0);
    const jobPriority=await publicationPriority(record.url,marker);
    const jobId='ranking-catalog-'+createHash('sha256').update(record.url).digest('hex');
    const job=await collectionRankingQueue.getJob(jobId);
    if(job){const state=await job.getState();
      if(['waiting','active','prioritized','delayed'].includes(state)){
        if(state!=='active'&&(job.priority??job.opts?.priority??20)>jobPriority)await job.changePriority({priority:jobPriority});
        continue;
      }
      if(state==='failed'&&Date.now()-(job.finishedOn??0)<60000)continue;
      await job.remove();
    }
    await collectionRankingQueue.add('COLLECTION_RANKING_CATALOG',{shop,record},{jobId,priority:jobPriority,attempts:5,backoff:{type:'exponential',delay:10000}});
  }
  let cursor;
  const marketRuleMarkers=new Map();
  for(const market of markets.values()){
    const country=new URL(market).searchParams.get('country');
    if(country&&!marketRuleMarkers.has(country))marketRuleMarkers.set(country,Number(await redis.get(marketRuleInvalidatedAtKey(shop,country)))||0);
  }
  for(;;){
    const rows=await prisma.collection.findMany({where:{shop,...(scopes?.length?{id:{in:scopes.map(id=>'gid://shopify/Collection/'+id)}}:{})},select:{id:true},orderBy:{id:'asc'},take:100,
      ...(cursor?{cursor:{id:cursor},skip:1}:{})});
    const markers=rows.length?await redis.mget(...rows.map(row=>catalogPublicationInvalidatedAtKey(shop,row.id))):[];
    for(let index=0;index<rows.length;index++)for(const market of markets.values()){
      const row=rows[index];
      const url=new URL(market);url.searchParams.set('collectionId',String(row.id).split('/').pop());
      const record=normalizeCollectionWarmup(shop,url,row.id);if(!record)continue;
      const jobPriority=await publicationPriority(record.url,Math.max(Number(markers[index])||0,marketRuleMarkers.get(url.searchParams.get('country'))||0));
      const jobId='ranking-catalog-'+createHash('sha256').update(record.url).digest('hex');
      const job=await collectionRankingQueue.getJob(jobId);
      if(job){const state=await job.getState();if(['waiting','active','prioritized','delayed'].includes(state)){
        if(state!=='active'&&(job.priority??job.opts?.priority??20)>jobPriority)await job.changePriority({priority:jobPriority});
        continue;
      }
        if(state==='failed'&&Date.now()-(job.finishedOn??0)<60000)continue;
        await job.remove();}
      // Each job replays one collection only, so visitors can move ahead of the
      // background catalog between jobs. Ranking concurrency stays at one.
      // FIFO among catalog/recent builds preserves progress through unseen
      // collections; bounded prerequisite sweeps run ahead at priority 5.
      await collectionRankingQueue.add('COLLECTION_RANKING_CATALOG',{shop,record},{jobId,priority:jobPriority,
        attempts:5,backoff:{type:'exponential',delay:10000}});
    }
    if(rows.length<100){console.info('CFP: collection publication aliases',JSON.stringify({shop,markets:markets.size,present,missing}));return;}cursor=rows.at(-1).id;
  }
}

export async function scheduleRegisteredCollectionWarmups() {
  // Discover existing public registries after deployment, so the first visitor
  // does not have to populate the new shop index before warming can start.
  if (!discoveredRegistries) {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', 'collectionWarmupContextsV2:*', 'COUNT', 100);
      cursor = next;
      for (const key of keys) {
        const shop = key.slice('collectionWarmupContextsV2:'.length);
        if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) continue;
        const ttl = await redis.ttl(key);
        if (ttl <= 0) continue;
        // Preserve the registry's original remaining lifetime.
        await redis.zadd(warmupShopsKey, 'NX', Date.now() - (warmupRegistryLifetime - Math.min(ttl, warmupRegistryLifetime)) * 1000, shop);
      }
    } while (cursor !== '0');
    discoveredRegistries = true;
  }
  const registered = await redis.zrangebyscore(warmupShopsKey, Date.now() - warmupRegistryLifetime*1000, '+inf');
  const catalog = await prisma.collection.findMany({distinct:['shop'],select:{shop:true}});
  const shops = [...new Set([...registered,...catalog.map(collection=>collection.shop),...configuredWarmups.map(entry=>entry.shop)])];
  for (const shop of shops) {
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) continue;
    try {
      // Historical catalog metadata can outlive an uninstalled app session.
      // Do not repeatedly fill storefront queues with impossible admin reads.
      if(!await prisma.session.findFirst({where:{shop,isOnline:false},select:{id:true}}))continue;
      await scheduleCollectionFactRefresh(shop).catch(error=>console.error('CFP: Collection fact refresh unavailable:',error.name));
      await scheduleCollectionWarmup(shop);
      // Public rankings refresh every minute; catalog-wide order discovery
      // keeps its existing four-minute cadence and single worker lane.
      if (Date.now() - (orderDiscoveryAt.get(shop) ?? -Infinity) >= 240000) {
        await scheduleMissingCollectionOrders(shop);
        const previousAudit=coverageAuditAt.get(shop);
        const auditDue=Date.now()-(previousAudit??coverageAuditStartedAt)>=(previousAudit==null?300000:1800000);
        await scheduleCatalogCollectionWarmups(shop,null,10,null,false,auditDue);
        if(auditDue)coverageAuditAt.set(shop,Date.now());
        orderDiscoveryAt.set(shop, Date.now());
      }
    }
    catch (error) { console.error('CFP: Periodic collection warmup failed:', error.name); }
  }
}

export const scheduleCollectionWarmup=createCollectionWarmupScheduler(collectionRankingQueue);

export async function processCollectionWarmups(shop,collectionIds=null,catalogRecord=null) {
  if(catalogRecord&&!await prisma.session.findFirst({where:{shop,isOnline:false},select:{id:true}}))return {skipped:true};
  const seeds=seededWarmups(shop);
  const urls = catalogRecord ? [JSON.stringify(catalogRecord)] : [...seeds.map(record=>JSON.stringify(record)),...(seeds.length===publicPreparationLimit?[]:await redis.zrange(warmupContextsKey(shop), -(publicPreparationLimit-seeds.length), -1))];
  const { loader } = await import('../routes/api.filter.jsx');
  const seen=new Set(),result={rankingContextsReady:0,cardContextsReady:0,cardContextsUnavailable:0};
  for (const value of urls) {
    let record,url;
    try{record=JSON.parse(value);url=new URL(record.url);}catch{continue;}
    if(collectionIds&&!collectionIds.includes(record.collectionId))continue;
    if (url.origin !== 'https://ranking.internal' || url.pathname !== '/api/filter' || url.searchParams.get('shop') !== shop) continue;
    const keys=[...url.searchParams.keys()];
    if(new Set(keys).size!==keys.length||keys.some(key=>!publicParameters.has(key))||url.searchParams.get('page')!=='1')continue;
    const normalized=normalizeCollectionWarmup(shop,url,record.collectionId);
    if (!normalized || seen.has(normalized.url)) continue;
    seen.add(normalized.url);
    if(!catalogRecord){
      // A sweep dispatches bounded one-context jobs. It must yield to cold
      // visits between contexts, rather than rendering up to 40 pages itself.
      const jobId='ranking-catalog-'+createHash('sha256').update(normalized.url).digest('hex');
      const job=await collectionRankingQueue.getJob(jobId);
      if(job){const state=await job.getState();
        if(['waiting','active','prioritized','delayed'].includes(state)){
          if(state!=='active'&&(job.priority??job.opts?.priority??20)>10)await job.changePriority({priority:10});
          continue;
        }
        if(state==='failed'&&Date.now()-(job.finishedOn??0)<60000)continue;
        await job.remove();
      }
      // Recurring recent-page replay shares catalog FIFO priority. Promoting
      // the same hot pages every minute can otherwise starve unseen pages.
      // Real visitors/changed-card refreshes retain their separate priorities.
      await collectionRankingQueue.add('COLLECTION_RANKING_CATALOG',{shop,record:normalized},
        {jobId,priority:10,attempts:5,backoff:{type:'exponential',delay:10000}});
      continue;
    }
    // Validate existing complete cards before reconstructing the ranking spec.
    // This probe checks live epochs/order/documents and creates no visitor
    // session or follow-up warmup. Ready pages yield worker time to cold pages.
    const readyUrl=new URL(normalized.url);readyUrl.searchParams.set('responseProfile','collection-cards-v1');readyUrl.searchParams.set('limit','50');
    try{
      const market=await getMarketAvailabilityState(shop,readyUrl.searchParams.get('country'));
      const ready=market.status==='pending'?null:await getPreparedCollectionCards(new Request(readyUrl),{probe:true,publishedOnly:true,marketAvailabilityVersion:market.version});
      if(ready?.status===200&&ready.headers?.get('X-CFP-Collection-Cards')==='published'){
        result.rankingContextsReady++;result.cardContextsReady++;continue;
      }
    }catch{/* Optional probes must not prevent canonical preparation. */}
    const response = await loader({ request: new Request(normalized.url), params: {}, context: {
      rankingWarmup: true, rankingPrecompute: Boolean(catalogRecord),
    } });
    const payload = response instanceof Response ? await response.json() : response.data;
    if (payload?.crash) throw Error('Collection warmup could not prepare a request');
    if(catalogRecord){
      // Pending Shopify order/rule revisions must retry, never count as ready.
      if(response.status>=400||payload?.warmup!==true)throw Error('Collection catalog preparation is not ready');
      console.info('CFP: collection catalog ranking ready',JSON.stringify({shop,collectionId:normalized.collectionId,url:normalized.url}));
    }
    // Materialize cards too; a saved ID sequence alone still leaves the first
    // shopper waiting for product shaping and facet work. No sessions are
    // persisted by this trusted background-only rendering context.
    if(payload?.warmup===true){
      result.rankingContextsReady++;
      const cardsUrl=new URL(normalized.url);cardsUrl.searchParams.set('responseProfile','collection-cards-v1');cardsUrl.searchParams.set('limit','50');
      let cardsReady=false;
      try{
        const cards=await loader({request:new Request(cardsUrl),params:{},context:{rankingWarmup:true,rankingCardsPrecompute:true}});
        if(cards.status===200&&['stored','published'].includes(cards.headers?.get('X-CFP-Collection-Cards'))){
          const market=await getMarketAvailabilityState(shop,cardsUrl.searchParams.get('country'));
          const verified=market.status==='pending'?null:await getPreparedCollectionCards(new Request(cardsUrl),{probe:true,publishedOnly:true,marketAvailabilityVersion:market.version});
          cardsReady=verified?.status===200&&verified.headers?.get('X-CFP-Collection-Cards')==='published';
        }
        if(cardsReady){
          result.cardContextsReady++;
          console.info('CFP: collection cards ready',JSON.stringify({shop,collectionId:normalized.collectionId}));
        }else result.cardContextsUnavailable++;
      }catch(error){result.cardContextsUnavailable++;console.error('CFP: Optional collection cards warmup unavailable:',error.name);}
      // Catalog jobs own one context. A ranked ID list without reusable cards
      // is unfinished work; let BullMQ back off and retry this same job rather
      // than report completion or enqueue duplicate immediate work.
      if(catalogRecord&&!cardsReady)throw Object.assign(Error('Collection catalog cards are not ready'),{code:'COLLECTION_CARDS_NOT_READY'});
    }
  }
  // Product/rule saves must cover catalog collections even when their URLs are
  // absent from the recent-visitor registry. Jobs yield after each collection.
  if(!catalogRecord)await scheduleCatalogCollectionWarmups(shop,collectionIds);
  return result;
}
