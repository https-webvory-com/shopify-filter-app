import redis from "../app/services/redis.server.js";

async function flushCacheOnStartup() {
  console.log("CFP Startup: Initializing Redis cache flush...");
  try {
    const keys = await redis.keys("*fullApiResponse*");
    if (keys && keys.length > 0) {
      await redis.del(...keys);
      console.log(`CFP Startup: Successfully cleared ${keys.length} cached API responses from Redis.`);
    } else {
      console.log("CFP Startup: No stale fullApiResponse cache entries found in Redis.");
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
