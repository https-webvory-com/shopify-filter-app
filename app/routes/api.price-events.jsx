import {rateLimit} from '../services/rateLimiter.server';
import {priceEventHub} from '../services/priceEvents.server.js';
import {priceEventScope, priceEventResponse} from '../utils/priceEvents.js';

export async function loader({request}) {
  const headers = {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'};
  const scope = priceEventScope(new URL(request.url));
  if (!scope) return Response.json({error: 'Invalid price scope'}, {status: 400, headers});
  if (!await rateLimit(request, 150, 60)) return Response.json({error: 'Too many requests'}, {status: 429, headers});
  return priceEventResponse(request, scope, priceEventHub());
}
