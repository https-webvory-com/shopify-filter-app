/**
 * shopCache.server.js
 * 
 * Distributed Redis cache for shop-level config data (filter groups, global settings, merged values).
 * Ensures multiple AWS instances share the same cache and don't overload PostgreSQL.
 */
import redis from "./redis.server.js";

const TTL_SEC = 60; // 60 seconds

/**
 * Get a value from Redis cache, or fetch it if missing/expired.
 */
export async function getCached(key, fetchFn, customTtlSec = TTL_SEC) {
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached); // Cache hit ✅
    }
  } catch (error) {
    console.error("CFP Redis get error for key", key, error);
  }

  // Cache miss or expired — fetch fresh data
  const data = await fetchFn();

  try {
    if (data !== undefined && data !== null) {
      await redis.setex(key, customTtlSec, JSON.stringify(data));
    }
  } catch (error) {
    console.error("CFP Redis set error for key", key, error);
  }

  return data;
}

/**
 * Invalidate all cache entries for a specific shop in Redis.
 */
export async function invalidateShop(shop) {
  const shopStr = String(shop);
  try {
    const keys = await redis.keys(`*${shopStr}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    console.log(`CFP Cache: Invalidated ${keys.length} entries for ${shopStr}`);
  } catch (error) {
    console.error(`CFP Redis invalidate error for ${shopStr}:`, error);
  }
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
