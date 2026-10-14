import { data } from 'react-router';
import { findSearchRedirect } from '../services/searchRedirect.server.js';
import { rateLimit } from '../services/rateLimiter.server';

const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop') || '';
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) return data({ error: 'Invalid shop' }, { status: 400, headers });
  if (!await rateLimit(request)) return data({ error: 'Too many requests' }, { status: 429, headers });
  try {
    return data({ redirectUrl: await findSearchRedirect(shop, url.searchParams.get('q')) }, { headers });
  } catch (error) {
    console.error('Search redirect lookup failed:', error.name);
    // Redirect failures must leave ordinary search available.
    return data({ redirectUrl: null }, { headers });
  }
};
