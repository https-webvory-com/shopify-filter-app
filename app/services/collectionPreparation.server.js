import redis from './redis.server.js';
import { collectionRankingQueue } from './queue.server.js';
import prisma from '../db.server.js';
import meiliClient from './meiliClient.server.js';
import { applyMerchandisingRules, createMerchandisingComparator } from './merchandising.server.js';
import { prepareCollectionRanking } from '../utils/prepareCollectionRanking.js';
import { createCollectionPreparation, warmupContextsKey } from '../utils/collectionPreparation.js';
import {createHash} from 'node:crypto';

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
