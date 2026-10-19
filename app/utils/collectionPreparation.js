import { createHash } from 'node:crypto';
import {productRevisionKey} from './shopCacheInvalidation.js';

// Keep the last usable product-data version through idle periods. Explicit
// configuration revisions still invalidate it immediately.
export const preparationLifetime = 86400;
export const preparationFreshnessMs = 600000;
export const preparationRevisionKey = shop => `collectionPreparationRevision:${shop}`;
export const warmupContextsKey = shop => `collectionWarmupContextsV2:${shop}`;
export const warmupShopsKey = 'collectionWarmupShopsV2';
export const publicPreparationLimit = 40;
export const publicRetentionKey = shop => `collectionPreparedRetention:${shop}`;
const retainPublic = `
local previous = redis.call('GET', KEYS[3])
redis.call('SETEX', KEYS[2], ARGV[1], ARGV[2])
redis.call('SETEX', KEYS[3], ARGV[1], KEYS[2])
if previous and previous ~= KEYS[2] then
  local suffix = string.sub(previous, string.len(ARGV[5])+1)
  if string.sub(previous, 1, string.len(ARGV[5])) == ARGV[5] and string.len(suffix) == 64 and string.match(suffix, '^%x+$') then
    redis.call('DEL', previous)
    redis.call('ZREM', KEYS[1], previous)
  end
end
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local score = tonumber(ARGV[3])
if latest[2] then score = math.max(score, tonumber(latest[2])+1) end
redis.call('ZADD', KEYS[1], score, KEYS[2])
redis.call('EXPIRE', KEYS[1], ARGV[1])
local obsolete = redis.call('ZRANGE', KEYS[1], 0, -tonumber(ARGV[4])-1)
for _, key in ipairs(obsolete) do
  local suffix = string.sub(key, string.len(ARGV[5])+1)
  if string.sub(key, 1, string.len(ARGV[5])) == ARGV[5] and string.len(suffix) == 64 and string.match(suffix, '^%x+$') then
    redis.call('DEL', key)
  end
  redis.call('ZREM', KEYS[1], key)
end
return 1`;

function stable(value) {
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]),
  );
  return value;
}

export function preparationKey(spec) {
  const {productRevision, retainForIdle, orderUpdatedAt, ...identity}=spec;
  // Preparation ranks the complete set. Pagination and response projections
  // must not create separate scans or prevent a limit-25 warmup serving limit-50.
  if (identity.query) {
    const {limit,offset,attributesToRetrieve,attributesToHighlight,facets,...query}=identity.query;
    identity.query=query;
  }
  return `collectionPreparedSequence:${spec.shop}:background-v2:${createHash('sha256').update(JSON.stringify(stable(identity))).digest('hex')}`;
}

// Only Shopify's order may differ. Filters, tenant, configuration, rules and
// customer context remain part of the identity of the last usable sequence.
export function preparationOrderFallbackKey(spec) {
  const {orderedIds, orderRevision, ...identity}=spec;
  return preparationKey(identity).replace(':background-v2:', ':last-order-v1:');
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
      if (!warmup && ['waiting','prioritized','delayed'].includes(state) && (job.priority ?? job.opts?.priority) > priority) {
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
      // Long idle retention must not extend the old ten-minute window for
      // known stock/product changes when a refresh worker is unavailable.
      if (spec.retainForIdle === true && value.productRevision !== spec.productRevision &&
          Number.isFinite(value.preparedAt) && now() - value.preparedAt >= preparationFreshnessMs) {
        return { status: await schedule(key, spec, warmup) };
      }
      // Refresh a valid version before expiry without holding up visitors.
      if (value.productRevision !== spec.productRevision || !Number.isFinite(value.preparedAt) ||
          now() - value.preparedAt >= preparationFreshnessMs - 120000 || await redis.ttl(key) < 120) {
        try { await schedule(key, spec, true); } catch { /* A usable version remains valid if refresh scheduling fails. */ }
      }
      if (spec.retainForIdle === true && spec.needsShopifyOrder) {
        // Adopt already prepared records on deployment too, without requiring
        // a rebuild before the last-order reuse path can become available.
        try { await redis.setex(preparationOrderFallbackKey(spec), preparationLifetime, key); } catch { /* Optional reuse must not block a usable current ranking. */ }
      }
      return { status: 'ready', ids: value.ids, metadata: value.metadata };
    }
    if (spec.retainForIdle === true && spec.needsShopifyOrder) {
      const previousKey = await redis.get(preparationOrderFallbackKey(spec));
      if (previousKey && previousKey !== key && previousKey.startsWith(`collectionPreparedSequence:${spec.shop}:background-v2:`)) {
        let previous;
        try { previous=JSON.parse(await redis.get(previousKey)); } catch { /* A missing/corrupt record needs a fresh build. */ }
        if (valid(previous) && previous.productRevision === spec.productRevision &&
            Number.isFinite(previous.preparedAt) && now() - previous.preparedAt < preparationLifetime * 1000 &&
            await revision(spec.shop) === spec.revision) {
          try { await schedule(key, spec, true); } catch { /* The last complete version is still usable. */ }
          return {status:'ready',ids:previous.ids,metadata:previous.metadata,orderUpdatedAt:previous.orderUpdatedAt ?? null,cacheKey:previousKey};
        }
      }
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
    // Only ordinary public collection contexts get long retention. Do not
    // multiply memory usage for arbitrary filters or customer-specific scans.
    const payload = JSON.stringify({...value,productRevision:startedRevision,preparedAt:now(),orderUpdatedAt:spec.orderUpdatedAt});
    if (spec.retainForIdle === true && typeof redis.eval === 'function') {
      // Replace this context's old order version only after the new one is complete.
      // This keeps obsolete orders from evicting other collections from the budget.
      // The script can delete only this shop's prepared keys, never queue/session keys.
      await redis.eval(retainPublic, 3, publicRetentionKey(spec.shop), key, preparationOrderFallbackKey(spec),
        preparationLifetime, payload, now(), publicPreparationLimit, `collectionPreparedSequence:${spec.shop}:background-v2:`);
    } else await redis.setex(key, spec.retainForIdle === true ? preparationLifetime : 600, payload);
    if (await revision(spec.shop) !== spec.revision) { await redis.del(key); return { superseded: true }; }
    if (spec.retainForIdle === true && spec.needsShopifyOrder) {
      await redis.setex(preparationOrderFallbackKey(spec), preparationLifetime, key);
    }
    return { products: value.ids.length, refreshRequired: await productRevision(spec.shop,spec.collectionId) !== startedRevision };
  }
  // A current first-page sequence referencing a deleted/inactive product must
  // rebuild rather than repeatedly reissue the same broken browsing token.
  async function discard(spec, cacheKey = preparationKey(spec)) {
    // A returned last-order version must be discarded too if page hydration
    // detects deleted/inactive products. Other browsing sessions stay intact.
    const prefix=`collectionPreparedSequence:${spec.shop}:background-v2:`;
    if (!cacheKey.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(cacheKey.slice(prefix.length))) throw Error('Invalid preparation cache key');
    await redis.del(cacheKey);
  }
  return { revision, get, process, discard };
}
