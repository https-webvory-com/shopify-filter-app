import redis from './redis.server.js';
import { webhookQueue } from './queue.server.js';
import { unauthenticated } from '../shopify.server.js';
import { readCollectionBestSellingIds } from '../utils/collectionBestSelling.js';

const freshnessMs = 300000;
const snapshotKey = (shop, collectionId) => `collectionOrderSnapshot:${shop}:${collectionId}`;
const jobId = (shop, collectionId) => `collection-order-${encodeURIComponent(shop)}-${encodeURIComponent(collectionId)}`;

// Publish only complete snapshots. A failed refresh leaves the last good order intact.
export async function refreshCollectionBestSelling(shop, collectionId) {
  const { admin } = await unauthenticated.admin(shop);
  const ids = await readCollectionBestSellingIds(admin, collectionId);
  await redis.set(snapshotKey(shop, collectionId), JSON.stringify({ ids, updatedAt: Date.now() }));
  return ids;
}

export async function getCollectionBestSellingState(shop, collectionId) {
  let snapshot = null;
  try {
    const raw = await redis.get(snapshotKey(shop, collectionId));
    if (raw) snapshot = JSON.parse(raw);
    if (!Array.isArray(snapshot?.ids)) snapshot = null;
    if (snapshot && Date.now() - snapshot.updatedAt < freshnessMs) {
      return { ids: snapshot.ids, status: 'ready', updatedAt: snapshot.updatedAt };
    }
    // BullMQ's unique job ID deduplicates refreshes across web instances.
    const id = jobId(shop, collectionId);
    let job = await webhookQueue.getJob(id);
    let state = job ? await job.getState() : null;
    if (state === 'failed') {
      return { ids: snapshot?.ids ?? null, status: snapshot ? 'stale' : 'failed', refreshState: 'failed', updatedAt: snapshot?.updatedAt ?? null };
    }
    if (state === 'completed') {
      await job.remove();
      job = null;
    }
    if (!job) {
      job = await webhookQueue.add('COLLECTION_BEST_SELLING_REFRESH', { shop, collectionId }, { jobId: id });
      state = 'waiting';
    }
    return { ids: snapshot?.ids ?? null, status: snapshot ? 'stale' : 'pending', refreshState: state, updatedAt: snapshot?.updatedAt ?? null };
  } catch (error) {
    console.error('CFP: Collection order unavailable:', shop, error.message);
    return { ids: snapshot?.ids ?? null, status: snapshot ? 'stale' : 'failed', refreshState: 'failed', updatedAt: snapshot?.updatedAt ?? null };
  }
}

export async function getCollectionBestSellingIds(shop, collectionId) {
  return (await getCollectionBestSellingState(shop, collectionId)).ids;
}
