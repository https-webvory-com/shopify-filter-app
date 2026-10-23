import redis from './redis.server.js';
import {collectionRankingQueue} from './queue.server.js';
import {createMarketAvailability} from '../utils/marketAvailability.js';
const market=createMarketAvailability({redis,queue:collectionRankingQueue,readRevision:async shop=>await redis.get(`collectionPreparationRevision:${shop}`)||'0'});
export const getMarketAvailableProductIds=market.get;
export const prepareMarketAvailability=market.prepare;

export {marketAvailabilityVersion} from '../utils/marketAvailability.js';
