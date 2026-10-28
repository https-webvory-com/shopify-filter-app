import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const snippet = await fs.readFile('extensions/theme-extension/snippets/collectionFilterPro.liquid', 'utf8');
const start = snippet.indexOf('(function() {', snippet.indexOf('LIGHTHOUSE OPTIMIZATION'));
const end = snippet.indexOf('</script>', start);
const bootstrap = snippet.slice(start, end)
  .replaceAll('{{ shop.permanent_domain }}', 'owned.myshopify.com')
  .replaceAll('{{ cfp_collection_handle }}', 'search')
  .replaceAll('{{ cfp_collection_id }}', '')
  .replaceAll('{{ request.locale.iso_code }}', 'en');

function run(search) {
  const requests = [];
  const window = {location: {pathname: '/search', search}, Shopify: {locale: 'en', country: 'GB'}};
  const context = {window, document: {documentElement: {lang: 'en'}}, URLSearchParams, AbortController, URL,
    fetch: (url) => { requests.push(new URL(url)); return Promise.resolve({ok: true}); }, setTimeout, clearTimeout};
  vm.runInNewContext(bootstrap, context);
  return {requests, window};
}

test('search starts its scoped first page before deferred storefront scripts', async () => {
  const {requests, window} = run('?q=formal+dress');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('isSearch'), 'true');
  assert.equal(requests[0].searchParams.get('collectionHandle'), 'search');
  assert.equal(requests[0].searchParams.get('q'), 'formal dress');
  assert.equal(requests[0].searchParams.get('limit'), '25');
  assert.ok(window._cfpEarlySearch?.promise);
  await window._cfpEarlySearch.promise;
});

test('search with shopper filters leaves its complete request to the renderer', () => {
  const {requests, window} = run('?q=formal+dress&options%5BColor%5D%5B%5D=Blue');
  assert.equal(requests.length, 0);
  assert.equal(window._cfpEarlySearch, undefined);
  assert.equal(window._cfpEarlyFetch, undefined);
});

test('search reload with a sort parameter still starts its matching early request', () => {
  const {requests} = run('?q=formal+dress&sortBy=relevance');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('sortBy'), 'relevance');
});
