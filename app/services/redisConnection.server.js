// Shared endpoint without importing the app, database or background workers.
// The production Redis service may require authentication; keep credentials in
// the server environment, never in source or storefront responses.
const endpoint = new URL(process.env.REDIS_URL || 'redis://184.72.37.227:6379');
if (!endpoint.username && process.env.REDIS_USERNAME) endpoint.username = process.env.REDIS_USERNAME;
if (!endpoint.password && process.env.REDIS_PASSWORD) endpoint.password = process.env.REDIS_PASSWORD;
export const REDIS_URL = endpoint.toString();
export const redisConnectionOptions = {
  host: endpoint.hostname,
  port: Number(endpoint.port || 6379),
  ...(endpoint.username ? {username: decodeURIComponent(endpoint.username)} : {}),
  ...(endpoint.password ? {password: decodeURIComponent(endpoint.password)} : {}),
  ...(endpoint.protocol === 'rediss:' ? {tls: {}} : {}),
  family: 4,
  connectTimeout: 10000,
};
