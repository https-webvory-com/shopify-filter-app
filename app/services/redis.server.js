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
});

export default redis;
