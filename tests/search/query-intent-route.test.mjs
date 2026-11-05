import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { extractQueryIntent } from '../../app/utils/queryIntent.js';

test('instant search applies explicit market price and size only with serving proof', async () => {
  const code = (await transform(await fs.readFile('app/routes/api.search.jsx', 'utf8'),
    { loader: 'jsx', format: 'cjs' })).code;
  const calls = [];
  let priceReady = true;
  const mocks = {
    '../services/queryParser.server.js': { parseQuery: async query => ({
      intent: extractQueryIntent(query), colorIntent: { requested: [] },
    }) },
    '../utils/searchColor.js': { selectSearchColorVariant: () => null },
    '../utils/spellingCorrection.js': { spellingCorrection: () => null },
    '../utils/searchSuggestions.js': { buildSearchSuggestions: () => [] },
    '../services/suggestionBlacklist.server.js': { getActiveSuggestionBlacklist: async () => [] },
    'react-router': { data: (value, init) => Response.json(value, init) },
    '../db.server': { __esModule: true, default: {} },
    '../services/merchandising.server': { getActivePinningRuleForSearch: async () => null,
      getActiveRuleForSearch: async () => null },
    '../services/meiliClient.server': { __esModule: true, default: { index: () => ({
      getFilterableAttributes: async () => ['marketAvailablePriceMin_US', 'option_Size'],
    }) } },
    '../services/filterSettings.server': { getFilterGlobalSettings: async () => ({}) },
    '../services/shopCache.server': { getCached: async (_key, read) => read() },
    '../services/rateLimiter.server': { rateLimit: async () => true },
    '../services/semanticSearch.server': { semanticSearch: async (query, options) => {
      calls.push({ query, filter: options.filter });
      return { hits: [], totalHits: 0 };
    } },
    '../utils/instantSearchCard.js': { instantSearchCard: product => product,
      INSTANT_SEARCH_INDEX_FIELDS: [] },
    'node:crypto': { createHash },
    '../utils/searchCachePolicy.js': { searchCacheHeaders: () => ({ 'Cache-Control': 'no-store' }) },
    '../services/searchIndex.server.js': { getSearchIndexContext: async () => ({ uid: 'products', settings: null }),
      configuredSuggestions: async () => [] },
    '../utils/searchConfiguration.js': { publicSearchProduct: product => product },
    '../services/marketPriceCoverage.server.js': { marketPriceIntentReady: async () => priceReady },
    '../services/searchRanking.server.js': { rankSearchResults: async () => null },
  };
  const context = { module: { exports: {} }, exports: {}, URL, Response, setTimeout, console,
    require: name => { if (!Object.hasOwn(mocks, name)) throw Error(`Unexpected import ${name}`); return mocks[name]; } };
  vm.runInNewContext(code, context);
  const url = 'https://fixture/api/search?shop=fixture.myshopify.com&country=US&suggestionLimit=0&q=red%20prom%20dress%20under%20100%20size%2016w';
  let result = await context.module.exports.loader({ request: new Request(url) });
  assert.equal(result.status, 200);
  assert.equal(calls[0].query, 'red prom dress');
  assert.ok(calls[0].filter.includes('marketAvailablePriceMin_US < 100'));
  assert.ok(calls[0].filter.includes('option_Size = "16W"'));
  assert.equal((await result.json()).queryIntent.price.max, 100);
  priceReady = false;
  result = await context.module.exports.loader({ request: new Request(url) });
  assert.equal(result.status, 200);
  assert.equal(calls[1].query, 'red prom dress under 100 size 16w');
  assert.ok(!calls[1].filter.some(value => value.includes('marketAvailablePriceMin_US')));
  assert.equal((await result.json()).queryIntent.price, null);
});
