import redis from './redis.server.js';
import { collectionOrderQueue } from './queue.server.js';
import { unauthenticated } from '../shopify.server.js';
import { readCollectionBestSellingIds } from '../utils/collectionBestSelling.js';
import { createHash } from 'node:crypto';

const freshnessMs = 300000;
const retryCooldownMs = 30000;
export const collectionOrderSnapshotKey = (shop, collectionId) => `collectionOrderSnapshot:${shop}:${collectionId}`;
const snapshotKey = collectionOrderSnapshotKey;
const jobId = (shop, collectionId) => `collection-order-${encodeURIComponent(shop)}-${encodeURIComponent(collectionId)}`;

// Publish only complete snapshots. A failed refresh leaves the last good order intact.
export async function refreshCollectionBestSelling(shop, collectionId) {
  const previous = await redis.get(snapshotKey(shop, collectionId));
  const { admin } = await unauthenticated.admin(shop);
  const ids = await readCollectionBestSellingIds(admin, collectionId);
  const revision = createHash('sha256').update(JSON.stringify(ids)).digest('hex');
  await redis.set(snapshotKey(shop, collectionId), JSON.stringify({ ids, updatedAt: Date.now(), revision }));
  if (!previous || JSON.parse(previous).revision !== revision) {
    // Rebuild registered first pages only when the actual Shopify sequence changed.
    const {scheduleCollectionWarmup}=await import('./collectionPreparation.server.js');
    await scheduleCollectionWarmup(shop,[String(collectionId).split('/').pop()]);
  }
  return ids;
}

export async function invalidateCollectionBestSelling(shop, collectionId) {
  const key = snapshotKey(shop, collectionId);
  const raw = await redis.get(key);
  if (raw) {
    const snapshot = JSON.parse(raw);
    await redis.set(key, JSON.stringify({ ...snapshot, updatedAt: 0 }));
  }
}

export async function getCollectionBestSellingState(shop, collectionId, { warmup = false } = {}) {
  let snapshot = null;
  try {
    const raw = await redis.get(snapshotKey(shop, collectionId));
    if (raw) snapshot = JSON.parse(raw);
    if (!Array.isArray(snapshot?.ids)) snapshot = null;
    if (snapshot && !snapshot.revision) snapshot.revision = createHash('sha256').update(JSON.stringify(snapshot.ids)).digest('hex');
    if (snapshot && Date.now() - snapshot.updatedAt < freshnessMs) {
      return { ids: snapshot.ids, status: 'ready', updatedAt: snapshot.updatedAt, revision: snapshot.revision };
    }
    // BullMQ's unique job ID deduplicates refreshes across web instances.
    const id = jobId(shop, collectionId);
    let job = await collectionOrderQueue.getJob(id);
    let state = job ? await job.getState() : null;
    // Warmups and refreshes with a usable snapshot must yield to a visitor
    // whose collection has no order at all.
    const priority = warmup || snapshot ? 10 : 1;
    if (job && priority === 1 && ['waiting','prioritized','delayed'].includes(state) && (job.priority ?? job.opts?.priority) !== 1) {
      await job.changePriority({ priority });
    }
    if (state === 'failed') {
      if (Date.now() - (job.finishedOn ?? 0) < retryCooldownMs) {
        return { ids: snapshot?.ids ?? null, status: snapshot ? 'stale' : 'failed', refreshState: 'failed', updatedAt: snapshot?.updatedAt ?? null, revision: snapshot?.revision };
      }
      await job.remove();
      job = null;
    }
    if (state === 'completed') {
      await job.remove();
      job = null;
    }
    if (!job) {
      job = await collectionOrderQueue.add('COLLECTION_BEST_SELLING_REFRESH', { shop, collectionId }, { jobId: id, priority });
      state = 'waiting';
    }
    return { ids: snapshot?.ids ?? null, status: snapshot ? 'stale' : 'pending', refreshState: state, updatedAt: snapshot?.updatedAt ?? null, revision: snapshot?.revision };
  } catch (error) {
    console.error('CFP: Collection order unavailable:', shop, error.message);
    return { ids: snapshot?.ids ?? null, status: snapshot ? 'stale' : 'failed', refreshState: 'failed', updatedAt: snapshot?.updatedAt ?? null, revision: snapshot?.revision };
  }
}

export async function getCollectionBestSellingIds(shop, collectionId) {
  return (await getCollectionBestSellingState(shop, collectionId)).ids;
}
