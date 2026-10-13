import { createHash } from 'node:crypto';

export const preparationLifetime = 600;
export const preparationRevisionKey = shop => `collectionPreparationRevision:${shop}`;
export const warmupContextsKey = shop => `collectionWarmupContexts:${shop}`;

function stable(value) {
  if (value instanceof Date) return value.toJSON();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]),
  );
  return value;
}

export function preparationKey(spec) {
  return `collectionPreparedSequence:${spec.shop}:background-v1:${createHash('sha256').update(JSON.stringify(stable(spec))).digest('hex')}`;
}

export function createCollectionPreparation({ redis, queue, prepare, now = Date.now }) {
  const revision = async shop => String(await redis.get(preparationRevisionKey(shop)) ?? '0');
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
      if (state === 'completed' || state === 'failed') { await job.remove(); job = null; }
    }
    if (!job) await queue.add('COLLECTION_RANKING_PREPARE', { shop: spec.shop, key, spec }, { jobId, priority });
    return 'pending';
  }
  async function get(spec, { warmup = false } = {}) {
    if (await revision(spec.shop) !== spec.revision) return { status: 'pending' };
    const key = preparationKey(spec);
    const raw = await redis.get(key);
    if (raw) {
      const value = JSON.parse(raw);
      if (!Array.isArray(value.ids) || !value.metadata) throw Error('Invalid prepared collection ranking');
      if (await revision(spec.shop) !== spec.revision) return { status: 'pending' };
      // Refresh a valid version before expiry without holding up visitors.
      if (await redis.ttl(key) < 120) {
        try { await schedule(key, spec, true); } catch { /* A usable version remains valid if refresh scheduling fails. */ }
      }
      return { status: 'ready', ...value };
    }
    return { status: await schedule(key, spec, warmup) };
  }
  async function process({ key, spec }) {
    if (key !== preparationKey(spec)) throw Error('Invalid preparation identity');
    if (await revision(spec.shop) !== spec.revision) return { superseded: true };
    const value = await prepare(spec);
    // An admin save during the scan must never publish that outdated ranking.
    if (await revision(spec.shop) !== spec.revision) return { superseded: true };
    await redis.setex(key, preparationLifetime, JSON.stringify(value));
    if (await revision(spec.shop) !== spec.revision) { await redis.del(key); return { superseded: true }; }
    return { products: value.ids.length };
  }
  return { revision, get, process };
}
