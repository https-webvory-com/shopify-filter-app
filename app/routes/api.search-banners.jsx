import { data } from 'react-router';
import { getSearchBanners } from '../services/searchBanner.server.js';
import { rateLimit } from '../services/rateLimiter.server';

const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
export const loader = async ({ request }) => {
  const url = new URL(request.url), shop = url.searchParams.get('shop') || '';
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) return data({ error: 'Invalid shop' }, { status: 400, headers });
  if (!await rateLimit(request)) return data({ error: 'Too many requests' }, { status: 429, headers });
  try { return data({ banners: await getSearchBanners(shop, url.searchParams.get('q')) }, { headers }); }
  catch (error) { console.error('Search banner lookup failed:', error.name); return data({ banners: [] }, { headers }); }
};
