import redis from './redis.server.js';
import { collectionRankingQueue } from './queue.server.js';
import prisma from '../db.server.js';
import meiliClient from './meiliClient.server.js';
import { applyMerchandisingRules, createMerchandisingComparator } from './merchandising.server.js';
import { prepareCollectionRanking } from '../utils/prepareCollectionRanking.js';
import { createCollectionPreparation, warmupContextsKey, warmupShopsKey, publicPreparationLimit, warmupRegistryLifetime, normalizeCollectionWarmup } from '../utils/collectionPreparation.js';
import {createHash} from 'node:crypto';
import {collectionOrderSnapshotKey, getCollectionBestSellingState} from './collectionBestSelling.server.js';
import configuredWarmups from '../config/collection-prewarm.json';

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

const preparation = createCollectionPreparation({ redis, queue: collectionRankingQueue, prepare: spec =>
  prepareCollectionRanking(spec, { index: meiliClient.index('products'), prisma, arrange: applyMerchandisingRules, comparator:createMerchandisingComparator }),
  observe:event=>console.info('CFP: collection preparation',JSON.stringify(event)),
});
const publicParameters = new Set(['shop', 'locale', 'language', 'country', 'collectionHandle', 'collectionId', 'sortBy', 'page', 'limit', 'responseProfile']);

export const getCollectionPreparationRevision = preparation.revision;
export const getPreparedCollectionRanking = preparation.get;
export const processCollectionPreparation = preparation.process;
export const discardPreparedCollectionRanking = preparation.discard;

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
// This only schedules deduplicated, low-priority jobs; scans stay in the worker.
let discoveredRegistries = false;
const orderDiscoveryAt = new Map();
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
export async function scheduleCatalogCollectionWarmups(shop) {
  const records=[...seededWarmups(shop),...(await redis.zrange(warmupContextsKey(shop),-publicPreparationLimit,-1)).flatMap(value=>{
    try{return [JSON.parse(value)];}catch{return [];}
  })];
  const markets=new Map();
  for(const record of records){
    const normalized=normalizeCollectionWarmup(shop,record.url,record.collectionId);
    if(!normalized)continue;
    const source=new URL(normalized.url),url=new URL('https://ranking.internal/api/filter');
    url.searchParams.set('shop',shop);
    for(const key of ['country','locale','language'])if(source.searchParams.has(key))url.searchParams.set(key,source.searchParams.get(key));
    url.searchParams.set('sortBy','best-selling');url.searchParams.set('page','1');
    // Reserve storage and worker throughput for the observed markets, rather
    // than generating every possible locale/country/sort combination.
    if(!markets.has(url.search))markets.set(url.search,url);
    if(markets.size===4)break;
  }
  if(!markets.size)return;
  let cursor;
  for(;;){
    const rows=await prisma.collection.findMany({where:{shop},select:{id:true},orderBy:{id:'asc'},take:100,
      ...(cursor?{cursor:{id:cursor},skip:1}:{})});
    for(const row of rows)for(const market of markets.values()){
      const url=new URL(market);url.searchParams.set('collectionId',String(row.id).split('/').pop());
      const record=normalizeCollectionWarmup(shop,url,row.id);if(!record)continue;
      const jobId='ranking-catalog-'+createHash('sha256').update(record.url).digest('hex');
      const job=await collectionRankingQueue.getJob(jobId);
      if(job){const state=await job.getState();if(['waiting','active','prioritized','delayed'].includes(state))continue;
        if(state==='failed'&&Date.now()-(job.finishedOn??0)<60000)continue;
        await job.remove();}
      // Each job replays one collection only, so visitors can move ahead of the
      // background catalog between jobs. Ranking concurrency stays at one.
      await collectionRankingQueue.add('COLLECTION_RANKING_CATALOG',{shop,record},{jobId,priority:20});
    }
    if(rows.length<100)return;cursor=rows.at(-1).id;
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
      await scheduleCollectionWarmup(shop);
      // Public rankings refresh every minute; catalog-wide order discovery
      // keeps its existing four-minute cadence and single worker lane.
      if (Date.now() - (orderDiscoveryAt.get(shop) ?? -Infinity) >= 240000) {
        await scheduleMissingCollectionOrders(shop);
        await scheduleCatalogCollectionWarmups(shop);
        orderDiscoveryAt.set(shop, Date.now());
      }
    }
    catch (error) { console.error('CFP: Periodic collection warmup failed:', error.name); }
  }
}

export async function scheduleCollectionWarmup(shop,collectionIds=null) {
  const scopes=collectionIds?[...new Set(collectionIds.map(id=>String(id).split('/').pop()))].sort():null;
  const jobId='ranking-warm-'+createHash('sha256').update(JSON.stringify([shop,scopes])).digest('hex');
  const job=await collectionRankingQueue.getJob(jobId);
  if(job){const state=await job.getState();if(['waiting','active','prioritized','delayed'].includes(state))return;
    if(state==='completed'||state==='failed')await job.remove();}
  await collectionRankingQueue.add('COLLECTION_RANKING_WARM',{shop,collectionIds:scopes},{jobId,priority:10,delay:500});
}

export async function processCollectionWarmups(shop,collectionIds=null,catalogRecord=null) {
  if(catalogRecord&&!await prisma.session.findFirst({where:{shop,isOnline:false},select:{id:true}}))return {skipped:true};
  const seeds=seededWarmups(shop);
  const urls = catalogRecord ? [JSON.stringify(catalogRecord)] : [...seeds.map(record=>JSON.stringify(record)),...(seeds.length===publicPreparationLimit?[]:await redis.zrange(warmupContextsKey(shop), -(publicPreparationLimit-seeds.length), -1))];
  const { loader } = await import('../routes/api.filter.jsx');
  const seen=new Set();
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
    const response = await loader({ request: new Request(normalized.url), params: {}, context: { rankingWarmup: true } });
    const payload = response instanceof Response ? await response.json() : response.data;
    if (payload?.crash) throw Error('Collection warmup could not prepare a request');
  }
}
