import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRanking, loadModule } from './helpers/search-ranking.mjs';
import * as color from '../../app/utils/searchColor.js';
import { spellingCorrection } from '../../app/utils/spellingCorrection.js';
import { buildSearchSuggestions } from '../../app/utils/searchSuggestions.js';
import { reorderSearchPins } from '../../app/utils/reorderSearchPins.js';
import * as availableVariants from '../../app/utils/availableVariants.js';

const gid = id => `gid://shopify/Product/${id}`;
const shop = 'fixture.myshopify.com';
const product = (id, extra = {}) => ({ id: String(id), title: 'Dress ' + id, status: 'ACTIVE', shop,
  tags: [], priceMin: Number(id), options: [{ name: 'Color', values: ['Green'] }], images: ['green.jpg'],
  variantPrices: [{ id: String(id), option1: 'Green', available: true, price: Number(id), imageUrl: 'green.jpg' }], ...extra });

async function fixture({ docs = Array.from({ length: 451 }, (_, i) => product(i + 1)), saved = [], rule = null,
  pins = null, settings = {}, parsedQuery = null } = {}) {
  const calls = [];
  const prisma = { product: { findMany: async ({ where }) => {
    assert.equal(where.shop, shop); assert.equal(where.status.mode, 'insensitive');
    return saved.filter(p => where.id.in.includes(p.id) && p.status.toLowerCase() === 'active' && p.shop === shop);
  } }, mergedValue: { findMany: async () => [] } };
  const search = async (query, options) => {
    calls.push({ query, options });
    assert.ok(options.filter.some(f => f.includes(`shop = '${shop}'`)));
    assert.ok(!options.filter.some(f => /\bid IN/.test(f)), 'does not assume primary key is filterable');
    let hits = docs.map(p => structuredClone(p));
    if (options.sort?.[0] === 'priceMin:asc') hits.sort((a, b) => a.priceMin - b.priceMin);
    if (options.sort?.[0] === 'priceMin:desc') hits.sort((a, b) => b.priceMin - a.priceMin);
    return { hits: hits.slice(options.offset || 0, (options.offset || 0) + options.limit), estimatedTotalHits: hits.length };
  };
  const service = await loadRanking(prisma, search);
  const spec = { shop, query: 'green dresses', options: { filter: [`shop = '${shop}'`, "status = 'ACTIVE'"], sortBy: 'relevance' },
    rule, pinningRule: pins, globalSettings: settings, parsedQuery, limit: 25 };
  return { service, spec, calls, prisma, search };
}

test('ranks late boosted products and external pins before pagination with no duplicates or omissions', async () => {
  const docs = Array.from({ length: 451 }, (_, i) => product(i + 1, { tags: i === 450 ? ['featured'] : [] }));
  const saved = [product(900, { id: gid(900), variants: product(900).variantPrices })];
  const f = await fixture({ docs, saved, pins: { products: [{ id: gid(900) }, { id: gid(900) }] },
    rule: { conditions: [{ action: 'Boost', field: 'Tags', value: 'featured' }] } });
  const ids = [];
  for (let page = 1; page <= 19; page++) {
    const r = await f.service.rankSearchResults({ ...f.spec, page });
    assert.equal(r.total, 452); assert.equal(r.pinnedCount, 1);
    ids.push(...r.products.map(p => p.id));
  }
  assert.deepEqual(ids.slice(0, 3), [gid(900), gid(451), gid(1)]);
  assert.equal(new Set(ids).size, 452); assert.equal(ids.length, 452);
});

test('Exclude, Bury, Dynamic and rule Pin operate on the complete eligible set; explicit pins survive Exclude', async () => {
  const docs = [product(1), product(2), product(3), product(4), product(5)];
  const f = await fixture({ docs, saved: [product(1, { id: gid(1), variants: product(1).variantPrices })],
    pins: { products: [{ id: gid(1) }] }, rule: { conditions: [
      { action: 'Exclude', field: 'Product', value: 'Dress 1,Dress 2' },
      { action: 'Bury', field: 'Product', value: 'Dress 3' },
      { action: 'Dynamic', field: 'Product', value: 'Dress 4', operator: 'Set', operand: '50' },
      { action: 'Pin', field: 'Product', value: 'Dress 5' },
    ] } });
  const r = await f.service.rankSearchResults(f.spec);
  assert.deepEqual(Array.from(r.products, p => p.id), [gid(1), gid(5), gid(4), gid(3)]);
  assert.equal(r.total, 4);
});

for (const priority of [true, false]) test(`explicit price sort respects priority=${priority}`, async () => {
  const f = await fixture({ docs: [product(1), product(2), product(3)],
    saved: [product(3, { id: gid(3), variants: product(3).variantPrices })], pins: { products: [{ id: gid(3) }] },
    rule: { conditions: [{ action: 'Boost', field: 'Product', value: 'Dress 2' }] },
    settings: { prioritizeSortOverPinning: priority, prioritizeSortOverMerchandising: priority } });
  const r = await f.service.rankSearchResults({ ...f.spec, options: { ...f.spec.options, sort: ['priceMin:asc'], sortBy: 'price-ascending' } });
  assert.deepEqual(Array.from(r.products, p => p.id), priority ? [gid(1), gid(2), gid(3)] : [gid(3), gid(2), gid(1)]);
});

test('wrong-color, missing, inactive, foreign-shop and sold-out pins are excluded and not counted', async () => {
  const saved = [product(900, { id: gid(900), variants: [{ id: '1', option1: 'Red', available: true }] }),
    product(901, { id: gid(901), status: 'DRAFT', variants: product(901).variantPrices }),
    product(902, { id: gid(902), variants: [{ id: '2', option1: 'Green', available: false }] }),
    product(903, { id: gid(903), shop: 'foreign', variants: product(903).variantPrices })];
  const intent = color.resolveSearchColor('green dresses', ['Green']);
  const f = await fixture({ docs: [product(1)], saved, pins: { products: [900, 901, 902, 903, 904].map(id => ({ id: gid(id) })) },
    settings: { showOnlyInStock: true }, parsedQuery: { colorIntent: intent } });
  const r = await f.service.rankSearchResults(f.spec);
  assert.equal(r.pinnedCount, 0); assert.equal(r.total, 1); assert.equal(r.products[0].id, gid(1));
});

test('malformed pins and empty results remain usable', async () => {
  const f = await fixture({ docs: [], pins: { products: '{bad json' } });
  const r = await f.service.rankSearchResults(f.spec);
  assert.equal(r.total, 0); assert.equal(r.pinnedCount, 0);
});

test('search scopes, legacy page scope and specific query precedence remain isolated', async () => {
  const rows = [{ name: 'global', applyToAll: true, applyToSearchType: 'both' },
    { name: 'instant', searchQueries: ['Green Dresses'], applyToSearchType: 'instant' },
    { name: 'page', searchQueries: ['green dresses'], applyToSearchType: 'search' }];
  const service = await loadModule('app/services/merchandising.server.js', { '../db.server.js': { default: {
    pinnedProductRule: { findMany: async ({ where }) => { assert.equal(where.shop, shop); assert.equal(where.status, true); return rows; } },
  } } });
  assert.equal((await service.getActivePinningRuleForSearch(shop, ' GREEN DRESSES ', 'instant')).name, 'instant');
  assert.equal((await service.getActivePinningRuleForSearch(shop, 'green dresses', 'page')).name, 'page');
  assert.equal((await service.getActivePinningRuleForSearch(shop, 'green dresses today', 'instant')).name, 'global');
});

test('search merchandising normalizes exact phrases and checks customer tags, locale and schedule query', async () => {
  const rows = [{ name: 'vip', searchQueries: [' Dresses '], customerTags: 'vip', locales: 'en' },
    { name: 'all', searchQueries: [], customerTags: '', locales: '' }];
  const service = await loadModule('app/services/merchandising.server.js', { '../db.server.js': { default: {
    merchandisingRule: { findMany: async ({ where }) => { assert.equal(where.ruleType, 'search'); assert.equal(where.AND.length, 2); return rows; } },
  } } });
  assert.equal((await service.getActiveRuleForSearch(shop, ' dresses ', ['VIP'], 'en')).name, 'vip');
  assert.equal((await service.getActiveRuleForSearch(shop, 'dresses', [], 'en')).name, 'all');
  assert.equal((await service.getActiveRuleForSearch(shop, 'dresses', ['VIP'], 'fr')).name, 'all');
});

test('actual instant loader uses instant scope, applies merchandising and reports only visible pins', async () => {
  const f = await fixture({ docs: [product(1), product(2), product(3)] });
  const scopes = [];
  const rule = { conditions: [{ action: 'Boost', field: 'Product', value: 'Dress 3' }] };
  const route = await loadModule('app/routes/api.search.jsx', {
    'react-router': { data: (v, init) => Response.json(v, init) }, '../db.server': { default: f.prisma },
    '../services/searchRanking.server.js': f.service,
    '../services/merchandising.server': { getActivePinningRuleForSearch: async (_shop, _q, scope) => { scopes.push(scope); return null; }, getActiveRuleForSearch: async () => rule },
    '../services/queryParser.server.js': { parseQuery: async () => null }, '../utils/searchColor.js': color,
    '../utils/spellingCorrection.js': { spellingCorrection }, '../utils/searchSuggestions.js': { buildSearchSuggestions },
    '../services/semanticSearch.server': { semanticSearch: f.search },
    '../services/meiliClient.server': { default: { index: () => ({ searchForFacetValues: async () => ({ facetHits: [] }) }) } },
    '../services/filterSettings.server': {}, '../services/shopCache.server': { getCached: async (_key, read) => _key.startsWith('globalSettings') ? {} : read() },
    '../services/rateLimiter.server': { rateLimit: async () => true }, '../services/suggestionBlacklist.server.js': { getActiveSuggestionBlacklist: async () => [] },
  });
  const response = await route.loader({ request: new Request(`https://fixture/api/search?shop=${shop}&q=dress&limit=2`) });
  const r = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(scopes, ['instant']);
  assert.deepEqual(r.products.map(p => p.title), ['Dress 3', 'Dress 1']); assert.equal(r.pinnedCount, 0);
});

test('group drag preserves selected order, inserts before a target, and leaves selection targets unchanged', () => {
  const products = [1, 2, 3, 4, 5].map(id => ({ id }));
  assert.deepEqual(reorderSearchPins(products, 1, 4, [2, 4]).map(p => p.id), [1, 3, 2, 4, 5]);
  assert.deepEqual(reorderSearchPins(products, 1, 5, [2, 4]).map(p => p.id), [1, 3, 5, 2, 4]);
  assert.deepEqual(reorderSearchPins(products, 4, 0, [2, 4]).map(p => p.id), [5, 1, 2, 3, 4]);
  assert.equal(reorderSearchPins(products, 1, 3, [2, 4]), products);
});

test('pin-only relevance retains organic search relevance ahead of unrelated sales scores', async () => {
  const f = await fixture({ docs: [product(1, { bestSellingScore: 0 }), product(2, { bestSellingScore: 500 })],
    pins: { products: [] } });
  const r = await f.service.rankSearchResults(f.spec);
  assert.deepEqual(Array.from(r.products, p => p.id), [gid(1), gid(2)]);
});

test('search relevance correction leaves the collection comparator behavior unchanged',async()=>{
 const f=await fixture({docs:[]});
 const products=[{id:gid(1),bestSellingScore:0,_originalIndex:0},{id:gid(2),bestSellingScore:500,_originalIndex:1}];
 const legacy=f.service.merchandising.applyMerchandisingRules(products.map(p=>({...p})),null,'relevance',null,[],{});
 assert.deepEqual(Array.from(legacy,p=>p.id),[gid(2),gid(1)]);
 const search=f.service.merchandising.applyMerchandisingRules(products.map(p=>({...p})),null,'relevance',null,[],{preserveSearchRelevance:true});
 assert.deepEqual(Array.from(search,p=>p.id),[gid(1),gid(2)]);
});

test('candidate cache reuses retrieval while applying changed rules freshly and preserving cached documents', async () => {
  const f = await fixture({ docs: [product(1), product(2), product(3)] });
  const cached = new Map();
  const service = await loadRanking(f.prisma, f.search, async (key, read, ttl) => {
    assert.match(key, /^searchRankingCandidates:fixture\.myshopify\.com:/); assert.equal(ttl, 15);
    if (!cached.has(key)) cached.set(key, await read());
    return cached.get(key);
  });
  const boost = id => ({ conditions: [{ action: 'Boost', field: 'Product', value: 'Dress ' + id }] });
  assert.equal((await service.rankSearchResults({ ...f.spec, rule: boost(3) })).products[0].id, gid(3));
  assert.equal((await service.rankSearchResults({ ...f.spec, rule: boost(2) })).products[0].id, gid(2));
  assert.equal(f.calls.length, 2);
  assert.ok([...cached.values()][0].hits.every(p => p.merchandisingScore === undefined));
  await service.rankSearchResults({ ...f.spec, query: 'different phrase' });
  assert.equal(cached.size, 2);
});

test('wedding sentence uses one semantic window instead of overlapping hybrid pages or scanning the catalog', async () => {
  const f = await fixture({ docs: [] });
  const semanticCalls = [], keywordCalls = [], cache = new Map();
  const semantic = async (query, options) => {
    semanticCalls.push(options);
    // Production hybrid offsets overlapped. Any second hybrid page would
    // contain duplicate IDs and used to fail the whole storefront request.
    return { hits: Array.from({ length: options.limit }, (_, i) => product(i + 1)),
      estimatedTotalHits: 50582, semanticHitCount: options.limit };
  };
  const keyword = async (_query, options) => {
    keywordCalls.push(options);
    return { hits: [product(1), product(900)], estimatedTotalHits: 2 };
  };
  const service = await loadRanking(f.prisma, semantic, async (key, read) => {
    if (!cache.has(key)) cache.set(key, await read());
    return cache.get(key);
  }, keyword);
  const spec = { ...f.spec, query: 'i am looking for red dress for wedding  for the mother' };
  const first = await service.rankSearchResults(spec);
  const second = await service.rankSearchResults({ ...spec, page: 2 });
  assert.equal(semanticCalls.length, 1);
  assert.equal(semanticCalls[0].offset, 0);
  assert.equal(semanticCalls[0].limit, 200);
  assert.equal(keywordCalls.length, 1);
  assert.equal(first.total, 201);
  assert.equal(first.semanticHitCount, 200);
  const ids = [...first.products, ...second.products].map(p => p.id);
  assert.equal(new Set(ids).size, 50);
});

test('all lexical matches survive the semantic window, including a boost beyond 2000 results', async () => {
  const f = await fixture({ docs: [] });
  const docs = Array.from({ length: 2501 }, (_, i) => product(i + 1,
    { tags: i === 2500 ? ['featured'] : [] }));
  let semanticCalls = 0;
  const offsets = [];
  const service = await loadRanking(f.prisma, async () => {
    semanticCalls++;
    return { hits: docs.slice(0, 200), semanticHitCount: 0 };
  }, undefined, async (_query, options) => {
    offsets.push(options.offset);
    return { hits: docs.slice(options.offset, options.offset + options.limit) };
  });
  const result = await service.rankSearchResults({ ...f.spec,
    rule: { conditions: [{ action: 'Boost', field: 'Tags', value: 'featured' }] } });
  assert.equal(result.total, 2501);
  assert.equal(result.products[0].id, gid(2501));
  assert.equal(semanticCalls, 1);
  assert.deepEqual(offsets, [0, 1000, 2000]);
});

test('empty lexical matches still return semantic products and exact full lexical batches terminate', async () => {
  const f = await fixture({ docs: [] });
  const service = await loadRanking(f.prisma, async () => ({ hits: [product(1)], semanticHitCount: 1 }),
    undefined, async () => ({ hits: [] }));
  assert.equal((await service.rankSearchResults(f.spec)).products[0].id, gid(1));
  const full = await fixture({ docs: Array.from({ length: 2000 }, (_, i) => product(i + 1)) });
  assert.equal((await full.service.rankSearchResults(full.spec)).total, 2000);
  assert.equal(full.calls.filter(c => c.options.limit === 200).length, 1);
  assert.deepEqual(full.calls.filter(c => c.options.limit === 1000).map(c => c.options.offset), [0, 1000, 2000]);
});

test('invalid lexical pagination cannot loop forever or silently claim complete results', async () => {
  const f = await fixture({ docs: [] });
  const semantic = async () => ({ hits: [] });
  const broken = await loadRanking(f.prisma, semantic, undefined,
    async () => ({ hits: Array.from({ length: 1000 }, (_, i) => product(i + 1)) }));
  await assert.rejects(broken.rankSearchResults(f.spec), /pagination did not advance/);
  const incomplete = await loadRanking(f.prisma, semantic, undefined,
    async () => ({ hits: [product(1)], totalHits: 2 }));
  await assert.rejects(incomplete.rankSearchResults(f.spec), /Incomplete keyword/);
});

test('facets and price bounds describe all eligible ranked products, including external pins and exclusions', async () => {
  const f = await fixture({ docs: [product(1, { tags: ['featured'], vendor: 'A' }), product(2, { vendor: 'B' }), product(3, { vendor: 'Hidden' })],
    saved: [product(900, { id: gid(900), vendor: 'Pinned', priceMin: 0, variants: product(900).variantPrices })],
    pins: { products: [{ id: gid(900) }] }, rule: { conditions: [
      { action: 'Boost', field: 'Tags', value: 'featured' }, { action: 'Exclude', field: 'Product', value: 'Dress 3' },
    ] } });
  const r = await f.service.rankSearchResults({ ...f.spec, facetKeys: ['vendor', 'priceMin', 'option_Color'], limit: 1 });
  assert.equal(r.total, 3); assert.equal(r.products.length, 1);
  assert.deepEqual({ ...r.facetDistribution.vendor }, { A: 1, B: 1, Pinned: 1 });
  assert.deepEqual({ ...r.facetStats.priceMin }, { min: 0, max: 2 });
  assert.equal(r.facetDistribution.option_Color.Green, 3);
});

test('actual full search loader preserves the same pins, boosts, counts and page slots as instant ranking', async () => {
  let ordinaryQueries = 0;
  const f = await fixture({ docs: [product(1), product(2), product(3), product(4)],
    saved: [product(4, { id: gid(4), variants: product(4).variantPrices })] });
  const pins = { products: [{ id: gid(4) }] };
  const rule = { conditions: [{ action: 'Boost', field: 'Product', value: 'Dress 3' }] };
  const route = await loadModule('app/routes/api.filter.jsx', {
    'react-router': { data: (v, init) => Response.json(v, init) }, '../db.server': { default: f.prisma },
    '../services/searchRanking.server.js': f.service, '../services/merchandising.server': { ...f.service.merchandising,
      getActivePinningRuleForSearch: async (_s, _q, scope) => { assert.equal(scope, 'page'); return pins; }, getActiveRuleForSearch: async () => rule },
    '../utils/searchColor.js': color, '../utils/availableVariants.js': availableVariants,
    '../utils/spellingCorrection.js': { spellingCorrection }, '../utils/rankedCollectionPage.js': {}, '../utils/collectionPage.js': {},
    '../services/semanticSearch.server': { semanticMultiSearch: async queries => { ordinaryQueries++; return { results: await Promise.all(queries.map(q => f.search(q.q, q))) }; } },
    '../services/meiliClient.server': {}, '../services/filterSettings.server': {}, '../shopify.server': {},
    '../services/rateLimiter.server': { rateLimit: async () => true }, '../services/collectionBestSelling.server.js': {},
    '../services/collectionPreparation.server.js': {}, '../services/collectionRankingSession.server.js': { collectionRankingFingerprint: () => '' },
    '../services/shopCache.server': { getCached: async key => key.startsWith('globalSettings') ? {} : key.startsWith('mergedValues') ? [] : { resolvedCollectionId: null, resolvedCollectionTitle: '', activeGroupFilters: [] } },
  });
  const pages = [];
  for (const page of [1, 2, 3]) {
    const response = await route.loader({ request: new Request(`https://fixture/api/filter?shop=${shop}&isSearch=true&q=dress&limit=2&page=${page}`) });
    const r = await response.json(); assert.equal(response.status, 200, r.error);
    assert.equal(r.debug.searchRankingApplied, true); assert.equal(r.totalCount, 4);
    pages.push(r.products.map(p => p.id));
  }
  assert.deepEqual(pages, [[gid(4), gid(3)], [gid(1), gid(2)], []]);
  assert.equal(ordinaryQueries, 0, 'ranked searches must not perform an ordinary search that is discarded');
});

test('authenticated pin picker retains target-query scope when searching by title or excluding saved pins', async () => {
  const calls = [];
  const prisma = { product: { count: async args => { calls.push(args.where); return 1; },
    findMany: async () => [{ id: gid(1), title: 'Green Dress', images: ['green.jpg'] }] } };
  const route = await loadModule('app/routes/app.search.pinning.$id.jsx', {
    'react-router': {}, react: {}, '@shopify/app-bridge-react': {}, '@shopify/shopify-app-react-router/server': {},
    '../db.server': { default: prisma }, '../shopify.server': { authenticate: { admin: async () => ({ session: { shop } }) } },
    '../utils/availablePins.server.js': {}, '../components/merchandising/PinSearchField': {}, '../utils/reorderSearchPins.js': { reorderSearchPins },
    '../utils/pinProductSearch.server': { pinProductSearchFilter: async () => ({ title: { contains: 'Green' } }) },
    '../services/searchPicker.server.js': { searchPickerProducts: async (tenant, queries) => { assert.equal(tenant, shop); assert.deepEqual(Array.from(queries), ['green dresses']); return [{ id: gid(1) }]; } },
  });
  const response = await route.action({ params: { id: 'new' }, request: new Request('https://fixture/admin', { method: 'POST',
    body: new URLSearchParams({ intent: 'search', q: 'Green', targetQueries: '["green dresses"]', excludedIds: JSON.stringify([gid(9)]) }) }) });
  const r = await response.json();
  assert.equal(calls[0].shop, shop); assert.deepEqual(Array.from(calls[0].AND[0].id.in), [gid(1)]);
  assert.deepEqual(Array.from(calls[0].id.notIn), [gid(9)]); assert.deepEqual(r.nonMatchingPinnedIds, [gid(9)]);
});
