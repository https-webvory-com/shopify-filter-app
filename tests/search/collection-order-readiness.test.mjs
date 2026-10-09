import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js', 'utf8');
const helper = source.slice(source.indexOf('  async function waitForCollectionOrder('), source.indexOf('  async function fetchAndRenderData('));
function load(fetch) {
  const context = { fetch, DOMException, setTimeout: callback => setTimeout(callback, 0), clearTimeout };
  vm.runInNewContext(helper + '\nthis.wait = waitForCollectionOrder;', context);
  return context.wait;
}
const pending = { products: ['fallback'], debug: { collectionBestSellingStatus: 'pending' } };
test('cold collection replaces fallback with Shopify order before rendering', async () => {
  let calls = 0;
  const ready = { products: ['admin-first', 'admin-second'], debug: { collectionBestSellingStatus: 'ready' } };
  const wait = load(async (url, { signal }) => {
    assert.equal(url, '/api/filter?sortBy=best-selling&page=2');
    assert.equal(signal.aborted, false);
    return { ok: true, json: async () => ++calls === 1 ? pending : ready };
  });
  assert.equal(await wait(pending, '/api/filter?sortBy=best-selling&page=2', new AbortController().signal), ready);
  assert.equal(calls, 2);
});
test('ready and stale snapshots do not delay rendering', async () => {
  const wait = load(() => { throw Error('Unexpected request'); });
  for (const status of ['ready', 'stale', 'failed', 'inactive']) {
    const data = { debug: { collectionBestSellingStatus: status } };
    assert.equal(await wait(data, '/api/filter', new AbortController().signal), data);
  }
});
test('changing filters cancels a pending collection order request', async () => {
  const controller = new AbortController();
  controller.abort();
  const wait = load(() => { throw Error('Unexpected request'); });
  await assert.rejects(wait(pending, '/api/filter', controller.signal), { name: 'AbortError' });
});
test('unavailable workers cannot cause unlimited polling', async () => {
  let calls = 0;
  const wait = load(async () => { calls++; return { ok: true, json: async () => pending }; });
  assert.equal(await wait(pending, '/api/filter', new AbortController().signal), pending);
  assert.equal(calls, 30);
});
