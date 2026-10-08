import Redis from 'ioredis';



// Use AWS IP in production, and Localhost in development
const REDIS_URL = 'redis://184.72.37.227:6379';

let redis;

if (!global.__redis) {
  global.__redis = new Redis(REDIS_URL, {
    family: 4, // Force IPv4 to prevent Node.js IPv6 resolution bugs
    // Optional: wait a bit longer before timing out
    connectTimeout: 10000 
  });
}
redis = global.__redis;

redis.on('error', (err) => {
  console.error('CFP Redis Error:', err.message);
});

import { initWebhookWorker } from "../workers/webhookWorker.server.js";
import { initProductSyncWorker } from "../workers/productSyncWorker.server.js";

redis.on('connect', () => {
  console.log(`CFP Connected to Redis successfully at ${REDIS_URL}`);
  if (process.env.CFP_WORKER_MODE !== "web") {
    initWebhookWorker();
    initProductSyncWorker();
  }
  // A dedicated worker restart must not invalidate storefront caches.
  if (process.env.CFP_WORKER_MODE === "worker") return;
  // Auto-clear all stale fullApiResponse, merch, and pinning cache keys on server process startup/restart
  Promise.all([
    redis.keys('*fullApiResponse*'),
    redis.keys('*merch:*'),
    redis.keys('*pinning:*')
  ]).then(([fullKeys, merchKeys, pinKeys]) => {
    const allKeys = [...(fullKeys || []), ...(merchKeys || []), ...(pinKeys || [])];
    if (allKeys.length > 0) {
      redis.del(...allKeys).then((deletedCount) => {
        console.log(`CFP Startup: Automatically purged ${deletedCount} stale Redis cache keys (fullApiResponse/merch/pinning).`);
      }).catch((e) => console.error("CFP Startup cache delete error:", e.message));
    }
  }).catch((err) => {
    console.error('CFP Startup Redis keys search error:', err.message);
  });
});

export default redis;
