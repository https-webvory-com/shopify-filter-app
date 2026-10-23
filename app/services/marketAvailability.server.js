import redis from './redis.server.js';
import {collectionRankingQueue} from './queue.server.js';
import {createMarketAvailability} from '../utils/marketAvailability.js';
// Redis imports the worker registrations, which import this service. Defer
// reading those live bindings until initialization of the module graph finishes.
let market;
function getMarketAvailability() {
  return market ||= createMarketAvailability({
    redis,
    queue: collectionRankingQueue,
    readRevision: async shop => await redis.get(`collectionPreparationRevision:${shop}`) || '0',
  });
}
export const getMarketAvailableProductIds = (...args) => getMarketAvailability().get(...args);
export const prepareMarketAvailability = (...args) => getMarketAvailability().prepare(...args);

export {marketAvailabilityVersion} from '../utils/marketAvailability.js';
