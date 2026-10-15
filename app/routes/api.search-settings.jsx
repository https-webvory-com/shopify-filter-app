import { data } from 'react-router';
import { getSearchSettings } from '../services/searchSettings.server.js';
import { getActiveSuggestionBlacklist } from '../services/suggestionBlacklist.server.js';
import { filterBlacklistedSuggestions } from '../utils/suggestionBlacklist.js';
import { rateLimit } from '../services/rateLimiter.server';

const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
export const loader = async ({ request }) => {
  const shop = new URL(request.url).searchParams.get('shop') || '';
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) return data({ error: 'Invalid shop' }, { status: 400, headers });
  if (!await rateLimit(request)) return data({ error: 'Too many requests' }, { status: 429, headers });
  try {
    const settings = await getSearchSettings(shop);
    if (settings?.manualSuggestions.length) {
      try { settings.manualSuggestions = filterBlacklistedSuggestions(settings.manualSuggestions, await getActiveSuggestionBlacklist(shop)); }
      catch { settings.manualSuggestions = []; }
    }
    return data({ settings }, { headers });
  } catch (error) {
    console.error('Search settings lookup failed:', error.name);
    return data({ settings: null }, { headers });
  }
};
