import redis from "../app/services/redis.server.js";

async function flushCacheOnStartup() {
  console.log("CFP Startup: Initializing Redis cache flush...");
  try {
    const [fullKeys, merchKeys, pinKeys] = await Promise.all([
      redis.keys("*fullApiResponse*"),
      redis.keys("*merch:*"),
      redis.keys("*pinning:*")
    ]);
    const allKeys = [...(fullKeys || []), ...(merchKeys || []), ...(pinKeys || [])];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
      console.log(`CFP Startup: Successfully cleared ${allKeys.length} cached API responses/rules from Redis.`);
    } else {
      console.log("CFP Startup: No stale cache entries found in Redis.");
    }
  } catch (err) {
    console.error("CFP Startup: Error flushing Redis cache on startup:", err.message);
  } finally {
    try {
      redis.disconnect();
    } catch (e) {}
    process.exit(0);
  }
}

flushCacheOnStartup();
