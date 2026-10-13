import { createHash } from 'node:crypto';
import {productRevisionKey} from './shopCacheInvalidation.js';

export const preparationLifetime = 600;
export const preparationRevisionKey = shop => `collectionPreparationRevision:${shop}`;
export const warmupContextsKey = shop => `collectionWarmupContextsV2:${shop}`;

function stable(value) {
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]),
  );
  return value;
}

export function preparationKey(spec) {
  const {productRevision, ...identity}=spec;
  // Preparation ranks the complete set. Pagination and response projections
  // must not create separate scans or prevent a limit-25 warmup serving limit-50.
  if (identity.query) {
    const {limit,offset,attributesToRetrieve,attributesToHighlight,facets,...query}=identity.query;
    identity.query=query;
  }
  return `collectionPreparedSequence:${spec.shop}:background-v2:${createHash('sha256').update(JSON.stringify(stable(identity))).digest('hex')}`;
}

export function createCollectionPreparation({ redis, queue, prepare, now = Date.now }) {
  const valid = value => value && Array.isArray(value.ids) && value.ids.every(id=>typeof id==='string'&&id.length>0) &&
    new Set(value.ids).size===value.ids.length && value.metadata && typeof value.metadata==='object' && !Array.isArray(value.metadata);
  const revision = async shop => String(await redis.get(preparationRevisionKey(shop)) ?? '0');
  const productRevision = async (shop,collectionId) => String(await redis.get(productRevisionKey(shop,collectionId)) ?? '0');
  async function schedule(key, spec, warmup = false) {
    const priority = warmup ? 10 : 1;
    const jobId = `collection-ranking-${createHash('sha256').update(key).digest('hex')}`;
    let job = await queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (!warmup && ['waiting','prioritized','delayed'].includes(state) && job.opts?.priority > priority) {
        await job.changePriority({ priority });
      }
      if (state === 'failed' && now() - (job.finishedOn ?? 0) < 30000) return 'failed';
      if (state === 'completed' || state === 'failed') {
        try { await job.remove(); } catch(error) {
          // Another request may already have replaced or started this job.
          const current=await queue.getJob(jobId);
          if (current && ['completed','failed'].includes(await current.getState())) throw error;
        }
        job = await queue.getJob(jobId);
      }
    }
    if (!job) await queue.add('COLLECTION_RANKING_PREPARE', { shop: spec.shop, key, spec }, { jobId, priority });
    return 'pending';
  }
  async function get(spec, { warmup = false } = {}) {
    if (await revision(spec.shop) !== spec.revision) return { status: 'pending' };
    spec = {...spec, productRevision: await productRevision(spec.shop,spec.collectionId)};
    const key = preparationKey(spec);
    const raw = await redis.get(key);
    if (raw) {
      let value;
      try { value=JSON.parse(raw); } catch { /* Rebuild corrupt cache entries. */ }
      if (!valid(value)) {
        // The worker will replace this record. Avoid deleting a newly published
        // valid record if another worker completed after this read.
        return {status:await schedule(key,spec,warmup)};
      }
      if (await revision(spec.shop) !== spec.revision) return { status: 'pending' };
      // Refresh a valid version before expiry without holding up visitors.
      if (value.productRevision !== spec.productRevision || await redis.ttl(key) < 120) {
        try { await schedule(key, spec, true); } catch { /* A usable version remains valid if refresh scheduling fails. */ }
      }
      return { status: 'ready', ids: value.ids, metadata: value.metadata };
    }
    return { status: await schedule(key, spec, warmup) };
  }
  async function process({ key, spec }) {
    if (key !== preparationKey(spec)) throw Error('Invalid preparation identity');
    if (await revision(spec.shop) !== spec.revision) return { superseded: true };
    const startedRevision=await productRevision(spec.shop,spec.collectionId);
    const value = await prepare(spec);
    if (!valid(value)) throw Error('Invalid prepared collection ranking');
    // An admin save during the scan must never publish that outdated ranking.
    if (await revision(spec.shop) !== spec.revision) return { superseded: true };
    await redis.setex(key, preparationLifetime, JSON.stringify({...value,productRevision:startedRevision}));
    if (await revision(spec.shop) !== spec.revision) { await redis.del(key); return { superseded: true }; }
    return { products: value.ids.length, refreshRequired: await productRevision(spec.shop,spec.collectionId) !== startedRevision };
  }
  // A current first-page sequence referencing a deleted/inactive product must
  // rebuild rather than repeatedly reissue the same broken browsing token.
  async function discard(spec) { await redis.del(preparationKey(spec)); }
  return { revision, get, process, discard };
}
