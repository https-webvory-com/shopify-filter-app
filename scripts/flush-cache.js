import Redis from 'ioredis';
import { REDIS_URL } from '../app/services/redisConnection.server.js';

async function flushCacheOnStartup() {
  console.log("CFP Startup: Initializing Redis cache flush...");
  // Never load app workers/Prisma in this short-lived maintenance process.
  const redis = new Redis(REDIS_URL, {
    family: 4, lazyConnect: true, connectTimeout: 10000, commandTimeout: 10000,
    maxRetriesPerRequest: 1, retryStrategy: () => null,
  });
  redis.on('error', () => {}); // The awaited operation reports the failure below.
  try {
    await redis.connect();
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
      if (redis.status === 'ready') await redis.quit();
    } catch {} finally { redis.disconnect(); }
    // Let Node drain its handles naturally; do not force native teardown.
  }
}

await flushCacheOnStartup();
