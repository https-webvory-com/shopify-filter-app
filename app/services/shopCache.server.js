/**
 * shopCache.server.js
 * 
 * Safe in-memory cache for shop-level config data (filter groups, global settings, merged values).
 * These change rarely (only when admin saves settings), so caching them is perfectly safe.
 * 
 * Safety guarantees:
 *  ✅ MAX_SIZE limit → prevents memory leaks (oldest entries evicted automatically)
 *  ✅ TTL per entry → entries auto-expire, no stale data forever
 *  ✅ Crash-safe → if server restarts, cache is empty, falls back to DB (same as before)
 *  ✅ invalidateShop() → call this when admin saves settings to clear that shop's cache instantly
 */

const TTL_MS = 60_000; // 60 seconds
const MAX_SIZE = 500;  // max 500 cache entries before evicting oldest (safe for 500+ shops)

const cache = new Map();

/**
 * Get a value from cache, or fetch it if missing/expired.
 * @param {string} key - Cache key (e.g. "globalSettings:myshop.myshopify.com")
 * @param {Function} fetchFn - Async function to fetch data if cache miss
 * @returns {Promise<any>} Cached or freshly fetched data
 */
export async function getCached(key, fetchFn) {
  const entry = cache.get(key);

  if (entry && Date.now() - entry.ts < TTL_MS) {
    return entry.data; // Cache hit ✅
  }

  // Cache miss or expired — fetch fresh data
  const data = await fetchFn();

  // Evict oldest entry if at max size (prevents memory leak)
  if (cache.size >= MAX_SIZE) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }

  cache.set(key, { data, ts: Date.now() });
  return data;
}

/**
 * Invalidate all cache entries for a specific shop.
 * Call this when admin saves filter settings, merged values, or filter groups.
 * @param {string} shop - The shop domain
 */
export function invalidateShop(shop) {
  const shopStr = String(shop);
  for (const key of cache.keys()) {
    if (key.includes(shopStr)) {
      cache.delete(key);
    }
  }
  console.log(`CFP Cache: Invalidated all entries for ${shop}`);
}

/**
 * Get current cache stats (for debugging).
 */
export function getCacheStats() {
  return {
    size: cache.size,
    maxSize: MAX_SIZE,
    ttlMs: TTL_MS,
    keys: Array.from(cache.keys()),
  };
}
