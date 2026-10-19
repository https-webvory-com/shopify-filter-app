import redis from './redis.server.js';
import { collectionRankingQueue } from './queue.server.js';
import prisma from '../db.server.js';
import meiliClient from './meiliClient.server.js';
import { applyMerchandisingRules, createMerchandisingComparator } from './merchandising.server.js';
import { prepareCollectionRanking } from '../utils/prepareCollectionRanking.js';
import { createCollectionPreparation, warmupContextsKey, warmupShopsKey } from '../utils/collectionPreparation.js';
import {createHash} from 'node:crypto';
import {collectionOrderSnapshotKey, getCollectionBestSellingState} from './collectionBestSelling.server.js';

const preparation = createCollectionPreparation({ redis, queue: collectionRankingQueue, prepare: spec =>
  prepareCollectionRanking(spec, { index: meiliClient.index('products'), prisma, arrange: applyMerchandisingRules, comparator:createMerchandisingComparator }),
});
const publicParameters = new Set(['shop', 'locale', 'language', 'country', 'collectionHandle', 'collectionId', 'sortBy', 'page', 'limit']);

export const getCollectionPreparationRevision = preparation.revision;
export const getPreparedCollectionRanking = preparation.get;
export const processCollectionPreparation = preparation.process;
export const discardPreparedCollectionRanking = preparation.discard;

// Remember only anonymous, unfiltered first pages. Customer targeting and
// filtered requests remain separately scoped and are never replayed as public.
export async function registerCollectionWarmup(shop, requestUrl, collectionId) {
  const url = new URL(requestUrl);
  if(url.searchParams.get('shop')!==shop)return;
  const allowed = publicParameters;
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some(key => !allowed.has(key)) || url.searchParams.get('page') !== '1') return;
  const normalized = new URL('https://ranking.internal/api/filter');
  for (const [key, value] of url.searchParams) if (!['page','limit'].includes(key)) normalized.searchParams.set(key, value);
  normalized.searchParams.set('page', '1'); normalized.searchParams.set('limit', '25'); normalized.searchParams.sort();
  const key = warmupContextsKey(shop);
  await redis.zadd(key, Date.now(), JSON.stringify({url:normalized.toString(),collectionId:String(collectionId||'all').split('/').pop()}));
  await redis.zremrangebyrank(key, 0, -21);
  await redis.expire(key, 86400);
  await redis.zadd(warmupShopsKey, Date.now(), shop);
  await redis.zremrangebyscore(warmupShopsKey, '-inf', Date.now() - 86400000);
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
        await redis.zadd(warmupShopsKey, 'NX', Date.now() - (86400 - Math.min(ttl, 86400)) * 1000, shop);
      }
    } while (cursor !== '0');
    discoveredRegistries = true;
  }
  const registered = await redis.zrangebyscore(warmupShopsKey, Date.now() - 86400000, '+inf');
  const catalog = await prisma.collection.findMany({distinct:['shop'],select:{shop:true}});
  const shops = [...new Set([...registered,...catalog.map(collection=>collection.shop)])];
  for (const shop of shops) {
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) continue;
    try {
      await scheduleCollectionWarmup(shop);
      // Public rankings refresh every minute; catalog-wide order discovery
      // keeps its existing four-minute cadence and single worker lane.
      if (Date.now() - (orderDiscoveryAt.get(shop) ?? -Infinity) >= 240000) {
        await scheduleMissingCollectionOrders(shop);
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

export async function processCollectionWarmups(shop,collectionIds=null) {
  const urls = await redis.zrange(warmupContextsKey(shop), 0, -1);
  const { loader } = await import('../routes/api.filter.jsx');
  for (const value of urls) {
    let record,url;
    try{record=JSON.parse(value);url=new URL(record.url);}catch{continue;}
    if(collectionIds&&!collectionIds.includes(record.collectionId))continue;
    if (url.origin !== 'https://ranking.internal' || url.pathname !== '/api/filter' || url.searchParams.get('shop') !== shop) continue;
    const keys=[...url.searchParams.keys()];
    if(new Set(keys).size!==keys.length||keys.some(key=>!publicParameters.has(key))||url.searchParams.get('page')!=='1')continue;
    const response = await loader({ request: new Request(url), params: {}, context: { rankingWarmup: true } });
    const payload = response instanceof Response ? await response.json() : response.data;
    if (payload?.crash) throw Error('Collection warmup could not prepare a request');
  }
}
