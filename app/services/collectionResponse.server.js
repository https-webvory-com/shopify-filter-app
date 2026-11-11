import redis from './redis.server.js';
import {createCollectionResponseCache} from '../utils/collectionResponse.js';
import {configurationRevisionKey, productRevisionKey, presentationRevisionKey} from '../utils/shopCacheInvalidation.js';

const cache = createCollectionResponseCache({readRevision: async shop => {
  if (redis.status !== 'ready') throw Error('Collection response cache unavailable');
  const values = await Promise.all([redis.get(configurationRevisionKey(shop)), redis.get(productRevisionKey(shop,'all')), redis.get(presentationRevisionKey(shop))]);
  return values.map(value=>String(value ?? '0'));
}});
export const beginCollectionResponse = cache.begin;
export {collectionPageFingerprint} from '../utils/collectionResponse.js';
