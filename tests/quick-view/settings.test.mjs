import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

async function moduleWithMocks(file, imports) {
  const { code } = await transform(await fs.readFile(file, 'utf8'), { loader: 'jsx', format: 'cjs' });
  const context = { module: { exports: {} }, exports: {}, Response, URL, console,
    require: name => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; } };
  vm.runInNewContext(code, context);
  return context.module.exports;
}

test('General Settings persists chart visibility and both Quick View modes', async () => {
  let saved;
  const route = await moduleWithMocks('app/routes/app.settings.general.jsx', {
    'react-router': {}, react: {}, '@shopify/shopify-app-react-router/server': {},
    '../shopify.server': { authenticate: { admin: async () => ({ session: { shop: 'fixture.myshopify.com' } }) } },
    '../services/filterSettings.server': { updateFilterGlobalSettings: async (shop, data) => { saved = { shop, ...data }; } },
  });
  for (const enabled of [true, false]) {
    const request = new Request('https://fixture.test/settings', { method: 'POST', body: new URLSearchParams({
      showQuickViewSizeChart: String(enabled), quickViewStyle: 'theme', showQuickViewInstantSearch: 'true', showQuickViewCollection: 'false',
      quickViewInstantSearchStyle: 'app', showQuickViewInstantSearchSizeChart: String(!enabled),
    }) });
    assert.equal((await route.action({ request })).status, 200);
    assert.equal(saved.showQuickViewSizeChart, enabled);
    assert.equal(saved.quickViewStyle, 'theme');
    assert.equal(saved.quickViewInstantSearchStyle, 'app');
    assert.equal(saved.showQuickViewInstantSearchSizeChart, !enabled);
    assert.equal(saved.showQuickViewInstantSearch, true);
    assert.equal(saved.showQuickViewCollection, false);
    assert.equal(saved.shop, 'fixture.myshopify.com');
  }
  // An admin page loaded before rollout must not silently opt an existing shop out.
  await route.action({ request: new Request('https://fixture.test/settings', { method: 'POST', body: new URLSearchParams({ showQuickViewInstantSearch: 'true' }) }) });
  assert.equal(Object.hasOwn(saved, 'showQuickViewSizeChart'), false);
  assert.equal(Object.hasOwn(saved, 'quickViewStyle'), false);
  assert.equal(Object.hasOwn(saved, 'quickViewInstantSearchStyle'), false);
  assert.equal(Object.hasOwn(saved, 'showQuickViewInstantSearchSizeChart'), false);
  for (const style of ['app', 'invalid']) {
    await route.action({ request: new Request('https://fixture.test/settings', { method: 'POST', body: new URLSearchParams({ quickViewStyle: style }) }) });
    assert.equal(saved.quickViewStyle, 'app');
  }
});

test('settings update awaits cache invalidation before returning', async () => {
  const events = [];
  const service = await moduleWithMocks('app/services/filterSettings.server.js', {
    '../db.server': { default: { filterGlobalSetting: { upsert: async args => { events.push(args); return args.update; } } }, __esModule: true },
    './shopCache.server': { invalidateShop: async shop => { await new Promise(resolve => setTimeout(resolve, 10)); events.push(shop); } },
  });
  const result = await service.updateFilterGlobalSettings('fixture.myshopify.com', { showQuickViewSizeChart: false });
  assert.equal(result.showQuickViewSizeChart, false);
  assert.equal(events[0].create.showQuickViewSizeChart, false);
  assert.equal(events[1], 'fixture.myshopify.com');
});

test('public Quick View configuration exposes only flags and never creates shops', async () => {
  let reads = 0;
  let allowed = true;
  const route = await moduleWithMocks('app/routes/api.quick-view.jsx', {
    '../db.server': { __esModule: true, default: { filterGlobalSetting: { findUnique: async () => {
      reads++;
      return { quickViewStyle: 'theme', showQuickViewSizeChart: true, showQuickViewCollection: false, integrations: { private: 'not public' }, shop: 'fixture.myshopify.com' };
    } } } },
    '../services/shopCache.server': { getCached: async (key, read) => { assert.ok(key.startsWith('quickViewSettings:')); return read(); } },
    '../services/rateLimiter.server': { rateLimit: async () => allowed },
  });
  const load = shop => route.loader({ request: new Request(`https://fixture.test/api/quick-view?shop=${shop}`) });
  assert.equal((await load('invalid.example')).status, 400);
  assert.equal(reads, 0);
  const response = await load('fixture.myshopify.com');
  const flags = await response.json();
  assert.equal(flags.quickViewStyle, 'theme');
  assert.equal(flags.quickViewInstantSearchStyle, 'theme');
  assert.equal(flags.showQuickViewInstantSearchSizeChart, true);
  assert.equal(flags.showQuickViewCollection, false);
  assert.deepEqual(Object.keys(flags).sort(), ['isWholesale', 'quickViewStyle', 'quickViewInstantSearchStyle', 'showQuickViewInstantSearchSizeChart', 'showQuickViewCollection', 'showQuickViewInstantSearch', 'showQuickViewSizeChart'].sort());
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  allowed = false;
  assert.equal((await load('fixture.myshopify.com')).status, 429);
  assert.equal(reads, 1);
});
