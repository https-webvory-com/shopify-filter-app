import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js', 'utf8');
const start = source.indexOf('        let data = null;');
const end = source.indexOf('      data = await waitForCollectionOrder', start);
assert.ok(start >= 0 && end > start);
const requestBlock = source.slice(start, end);
const earlyHelper = source.slice(source.indexOf('  async function takeEarlyCollectionResponse('), source.indexOf('  async function waitForCollectionOrder('));
async function load({ template = 'search', page = 1, limit = 4, sort = 'relevance', loadMore = false } = {}) {
  const calls = [], expectedOrder = Array.from({ length: 47 }, (_, i) => 'ranked-' + (i + 1));
  const early = { products: expectedOrder.slice(0, 25), source: 'unscoped-early' };
  const params = new URLSearchParams({ shop: 'fixture.myshopify.com', q: 'green dresses', country: 'IN', locale: 'en', isSearch: 'true', sortBy: sort, page: String(page), limit: String(limit), 'options[Color][]': 'Green' });
  const context = { window: { _cfpEarlyFetch: Promise.resolve(early) }, templateName: template,
    rankedCollection: template !== 'search' && sort !== 'manual', isLoadMore: loadMore,
    activeFilters: { page }, queryParams: params, API_DOMAIN: 'https://api.test', fetchSignal: new AbortController().signal,
    fetchCollectionResponse: async url => { calls.push(url); return { status: 200, json: async () => ({ products: expectedOrder.slice((page - 1) * limit, page * limit), source: 'scoped' }) }; },
  };
  const data = await vm.runInNewContext(earlyHelper + '\n(async()=>{' + requestBlock + '\nreturn data;})()', context);
  return { data, calls, early, context };
}

test('first submitted search ignores early collection response and sends current page size, query and filters', async () => {
  const f = await load();
  assert.equal(f.data.source, 'scoped'); assert.equal(f.data.products.length, 4); assert.equal(f.calls.length, 1);
  const params = new URL(f.calls[0]).searchParams;
  for (const [key, value] of Object.entries({ isSearch: 'true', q: 'green dresses', limit: '4', page: '1', 'options[Color][]': 'Green', country: 'IN', locale: 'en', sortBy: 'relevance' })) assert.equal(params.get(key), value);
});
test('first search and Load More have no duplicates at a nondefault page boundary', async () => {
  const first = await load(), next = await load({ page: 2, loadMore: true });
  const products = [...first.data.products, ...next.data.products];
  assert.equal(products.length, 8); assert.equal(new Set(products).size, 8);
  assert.deepEqual(Array.from(products), Array.from({ length: 8 }, (_, i) => 'ranked-' + (i + 1)));
});
test('search early responses cannot override page sizes or explicit sort changes', async () => {
  for (const limit of [1, 25, 40]) for (const sort of ['relevance', 'price-ascending', 'manual']) {
    const f = await load({ limit, sort }); assert.equal(f.data.products.length, limit); assert.equal(f.calls.length, 1);
  }
});
test('eligible manual collection first load retains its existing early response', async () => {
  const f = await load({ template: 'collection', sort: 'manual' });
  assert.equal(f.data, f.early); assert.equal(f.calls.length, 0);
});
test('ranked collection, later page and Load More continue using their own requests', async () => {
  for (const options of [{ template: 'collection', sort: 'best-selling' }, { template: 'collection', sort: 'manual', page: 2 }, { template: 'collection', sort: 'manual', loadMore: true }]) {
    const f = await load(options); assert.equal(f.data.source, 'scoped'); assert.equal(f.calls.length, 1);
  }
});
