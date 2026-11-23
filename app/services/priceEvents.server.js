import Redis from 'ioredis';
import {redisConnectionOptions} from './redisConnection.server.js';
import {createPriceEventHub, PRICE_EVENT_CHANNEL} from '../utils/priceEvents.js';

export function priceEventHub() {
  return global.__cfpPriceEventHub ||= createPriceEventHub(() => new Redis({
    ...redisConnectionOptions, lazyConnect: true, enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  }));
}

export async function publishProductPriceChange(shop, productId) {
  const {default: redis} = await import('./redis.server.js');
  await redis.publish(PRICE_EVENT_CHANNEL, JSON.stringify({shop, ids: [String(productId).split('/').pop()]}));
}
