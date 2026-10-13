import redis from './redis.server.js';
import { collectionRankingQueue } from './queue.server.js';
import prisma from '../db.server.js';
import meiliClient from './meiliClient.server.js';
import { applyMerchandisingRules } from './merchandising.server.js';
import { prepareCollectionRanking } from '../utils/prepareCollectionRanking.js';
import { createCollectionPreparation, warmupContextsKey } from '../utils/collectionPreparation.js';

const preparation = createCollectionPreparation({ redis, queue: collectionRankingQueue, prepare: spec =>
  prepareCollectionRanking(spec, { index: meiliClient.index('products'), prisma, arrange: applyMerchandisingRules }),
});

export const getCollectionPreparationRevision = preparation.revision;
export const getPreparedCollectionRanking = preparation.get;
export const processCollectionPreparation = preparation.process;

// Remember only anonymous, unfiltered first pages. Customer targeting and
// filtered requests remain separately scoped and are never replayed as public.
export async function registerCollectionWarmup(shop, requestUrl) {
  const url = new URL(requestUrl);
  const allowed = new Set(['shop', 'locale', 'language', 'country', 'collectionHandle', 'collectionId', 'sortBy', 'page', 'limit']);
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some(key => !allowed.has(key)) || url.searchParams.get('page') !== '1') return;
  const normalized = new URL('https://ranking.internal/api/filter');
  for (const [key, value] of url.searchParams) if (!['page','limit'].includes(key)) normalized.searchParams.set(key, value);
  normalized.searchParams.set('page', '1'); normalized.searchParams.set('limit', '25'); normalized.searchParams.sort();
  const key = warmupContextsKey(shop);
  await redis.zadd(key, Date.now(), normalized.toString());
  await redis.zremrangebyrank(key, 0, -21);
  await redis.expire(key, 86400);
}

export async function processCollectionWarmups(shop) {
  const urls = await redis.zrange(warmupContextsKey(shop), 0, -1);
  const { loader } = await import('../routes/api.filter.jsx');
  for (const value of urls) {
    const url = new URL(value);
    if (url.origin !== 'https://ranking.internal' || url.pathname !== '/api/filter' || url.searchParams.get('shop') !== shop) continue;
    const response = await loader({ request: new Request(url), params: {}, context: { rankingWarmup: true } });
    const payload = response instanceof Response ? await response.json() : response.data;
    if (payload?.crash) throw Error('Collection warmup could not prepare a request');
  }
}
