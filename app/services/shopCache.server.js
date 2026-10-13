/**
 * shopCache.server.js
 * 
 * Distributed Redis cache for shop-level config data (filter groups, global settings, merged values).
 * Ensures multiple AWS instances share the same cache and don't overload PostgreSQL.
 */
import redis from "./redis.server.js";

const TTL_SEC = 60; // 60 seconds
const pendingReads = new Map();
let cacheGeneration = 0;

/**
 * Get a value from Redis cache, or fetch it if missing/expired.
 */
export async function getCached(key, fetchFn, customTtlSec = TTL_SEC) {
  const generation = cacheGeneration;
  const shop = key.match(/(?:^|:)([a-z0-9][a-z0-9-]*\.myshopify\.com)(?=:|$)/i)?.[1];
  // Namespace configuration by the distributed revision too. A fetch running
  // in another web/worker process may finish after invalidation; its late write
  // then stays in the old namespace instead of resurrecting old settings.
  let cacheKey = key;
  if (shop) {
    try { cacheKey = `${key}:revision:${await redis.get(`collectionPreparationRevision:${shop}`) ?? '0'}`; }
    catch (error) { console.error('CFP: Cache revision unavailable:', error.name); }
  }
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached); // Cache hit ✅
    }
  } catch (error) {
    console.error("CFP Redis get error for key", key, error);
  }

  // Cache miss or expired — fetch fresh data
  if (pendingReads.has(cacheKey)) return pendingReads.get(cacheKey);
  const pending = (async () => {
    const data = await fetchFn();
    try {
      if (generation === cacheGeneration && data !== undefined && data !== null) {
        await redis.setex(cacheKey, customTtlSec, JSON.stringify(data));
      }
    } catch (error) {
      console.error("CFP Redis set error for key", key, error);
    }
    return data;
  })();
  pendingReads.set(cacheKey, pending);
  try { return await pending; }
  finally { if (pendingReads.get(cacheKey) === pending) pendingReads.delete(cacheKey); }
}

/**
 * Invalidate all cache entries for a specific shop in Redis.
 */
export async function invalidateShop(shop) {
  const shopStr = String(shop);
  // Keep this monotonic revision outside deletion. Builds from the previous
  // revision cannot become visible after an admin change or product update.
  const revision = await redis.incr(`collectionPreparationRevision:${shopStr}`);
  cacheGeneration++;
  pendingReads.clear();
  try {
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, found] = await redis.scan(cursor, 'MATCH', `*${shopStr}*`, 'COUNT', 200);
      cursor = next;
      const keys = found.filter(key => !['collectionOrderSnapshot:', 'collectionRankingSession:', 'collectionPreparationRevision:', 'collectionWarmupContexts:'].some(prefix => key.startsWith(prefix)));
      if (keys.length) deleted += await redis.del(...keys);
    } while (cursor !== '0');
    console.log(`CFP Cache: Invalidated ${deleted} entries for ${shopStr}`);
  } catch (error) {
    console.error(`CFP Redis invalidate error for ${shopStr}:`, error);
  }
  try {
    const { collectionRankingQueue } = await import('./queue.server.js');
    await collectionRankingQueue.add('COLLECTION_RANKING_WARM', { shop: shopStr }, {
      jobId: `collection-warm-${encodeURIComponent(shopStr)}-${revision}`, delay: 500, priority: 10,
    });
  } catch (error) { console.error('CFP: Could not schedule ranking warmup:', error.name); }
}

/**
 * Get current cache stats (for debugging).
 */
export async function getCacheStats() {
  try {
    const keys = await redis.keys("*");
    return {
      size: keys.length,
      ttlSec: TTL_SEC,
      keys: keys,
    };
  } catch (error) {
    console.error("CFP Redis stats error:", error);
    return {};
  }
}
