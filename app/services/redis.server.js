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

redis.on('connect', () => {
  console.log(`CFP Connected to Redis successfully at ${REDIS_URL}`);
  // Auto-clear stale fullApiResponse keys on server process startup/restart
  redis.keys('*fullApiResponse*').then((keys) => {
    if (keys && keys.length > 0) {
      redis.del(...keys).then((deletedCount) => {
        console.log(`CFP Startup: Automatically purged ${deletedCount} stale fullApiResponse cache keys from Redis.`);
      }).catch((e) => console.error("CFP Startup cache delete error:", e.message));
    }
  }).catch((err) => {
    console.error('CFP Startup Redis keys search error:', err.message);
  });
});

export default redis;
