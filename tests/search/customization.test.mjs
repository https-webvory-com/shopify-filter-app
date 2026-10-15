import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm, { Script } from 'node:vm';
import { loadModule } from './helpers/search-ranking.mjs';
import * as schema from '../../app/utils/customization.js';
const defaults = schema.DEFAULT_CUSTOMIZATION, plain = value => JSON.parse(JSON.stringify(value));
test('customization defaults preserve existing widgets and reject invalid inputs', () => {
  assert.deepEqual(schema.validateCustomization({ ...defaults, shop: 'ignored', themeId: 'ignored' }), defaults);
  for (const value of [null, [], {}, false]) assert.throws(() => schema.validateCustomization(value));
  for (const key of ['enabled', 'javascriptEnabled']) for (const value of ['true', 1, null]) assert.throws(() => schema.validateCustomization({ ...defaults, [key]: value }));
  for (const key of ['css', 'javascript']) {
    assert.equal(schema.validateCustomization({ ...defaults, [key]: 'a'.repeat(100000) })[key].length, 100000);
    for (const value of ['a'.repeat(100001), null, 'a\0b', {}]) assert.throws(() => schema.validateCustomization({ ...defaults, [key]: value }));
  }
});
test('theme identity accepts numeric IDs and GIDs, rejecting missing or malformed context', () => {
  for (const id of ['1', '193281622387', 'gid://shopify/OnlineStoreTheme/123']) assert.match(schema.normalizeThemeId(id), /^[1-9]\d*$/);
  for (const id of ['', null, '0', '../1', '-1', '1x', ' 1', '1'.repeat(21), 'gid://shopify/Product/1']) assert.throws(() => schema.normalizeThemeId(id));
});
test('filter swatches normalize, preserve names, and reject duplicates, injection and oversized lists', () => {
  assert.deepEqual(schema.validateCustomization({ ...defaults, swatches: [{ color: '  Navy   Blue ', hex: '#ABCD12' }] }).swatches, [{ color: 'Navy Blue', hex: '#abcd12' }]);
  const valid = { color: 'Navy', hex: '#123456' };
  for (const swatches of [null, [null], [{ ...valid, hex: 'red' }], [{ ...valid, color: '' }], [{ ...valid, color: 'a\0b' }], [valid, { ...valid, color: 'ＮＡＶＹ' }], Array(201).fill(valid)]) assert.throws(() => schema.validateCustomization({ ...defaults, swatches }));
});
async function fixture() {
  const rows = new Map(), key = value => value.shop + ':' + value.themeId;
  const service = await loadModule('app/services/customization.server.js', {
    'node:vm': { Script }, '../utils/customization.js': schema,
    '../db.server': { default: { themeCustomization: {
      findUnique: async ({ where }) => rows.get(key(where.shop_themeId)) || null,
      upsert: async ({ create }) => rows.set(key(create), create),
      deleteMany: async ({ where }) => rows.delete(key(where)),
    } } },
  });
  return { service, rows };
}
test('theme settings are isolated by shop AND theme; resetting one never changes another', async () => {
  const { service } = await fixture();
  assert.equal(await service.getCustomization('a', '1'), null);
  for (const [shop, id, css] of [['a', '1', 'a1'], ['a', '2', 'a2'], ['b', '1', 'b1']]) await service.saveCustomization(shop, id, { ...defaults, css });
  await service.resetCustomization('a', '1');
  assert.equal(await service.getCustomization('a', '1'), null);
  assert.equal((await service.getCustomization('a', '2')).css, 'a2');
  assert.equal((await service.getCustomization('b', '1')).css, 'b1');
});
test('syntax validation does not execute scripts and invalid edits preserve last saved code', async () => {
  const { service } = await fixture();
  await service.saveCustomization('a', '1', { ...defaults, javascript: "throw new Error('must not execute');" });
  await assert.rejects(service.saveCustomization('a', '1', { ...defaults, javascript: 'function (' }), /syntax error/);
  assert.match((await service.getCustomization('a', '1')).javascript, /must not execute/);
});
async function publicRoute(read, allowed = true) {
  return loadModule('app/routes/api.customization.jsx', { '../services/customization.server.js': { getCustomization: read }, '../utils/customization.js': schema, '../services/rateLimiter.server': { rateLimit: async () => allowed } });
}
const request = query => ({ request: new Request('https://fixture/api/customization?' + query) });
const context = 'shop=test.myshopify.com&themeId=1';
test('public API validates context, rate limits, isolates reads and keeps private controls out of JSON', async () => {
  let reads = 0;
  const route = await publicRoute(async (shop, themeId) => { reads++; assert.equal(shop, 'test.myshopify.com'); assert.equal(themeId, '1'); return { ...defaults, enabled: true, css: '.cfp{}', javascript: 'window.customRuns++;', javascriptEnabled: true }; });
  for (const query of ['', 'shop=bad&themeId=1', 'shop=test.myshopify.com&themeId=0']) assert.equal((await route.loader(request(query))).status, 400);
  assert.equal(reads, 0);
  const response = await route.loader(request(context)), body = await response.json();
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(body, { customization: { css: '.cfp{}', swatches: [], javascriptEnabled: true } });
  const blocked = await publicRoute(() => { throw Error('Must not read'); }, false);
  assert.equal((await blocked.loader(request(context))).status, 429);
});
test('missing, disabled, corrupt and offline customizations leave products usable with no executable script', async () => {
  for (const read of [async () => null, async () => ({ ...defaults, javascript: 'bad', javascriptEnabled: true }), async () => { throw Error('private DB details'); }]) {
    const route = await publicRoute(read);
    assert.deepEqual(await (await route.loader(request(context))).json(), { customization: null });
    assert.equal(await (await route.loader(request(context + '&asset=javascript'))).text(), '');
  }
});
test('custom JS runs once in a guarded function and runtime failure does not escape', async () => {
  for (const code of ['window.count++;', "throw Error('merchant error');"]) {
    const route = await publicRoute(async () => ({ ...defaults, enabled: true, javascriptEnabled: true, javascript: code }));
    const response = await route.loader(request(context + '&asset=javascript'));
    assert.match(response.headers.get('Content-Type'), /text\/javascript/);
    const env = { window: { count: 0 }, console: { error() {} } };
    vm.runInNewContext(await response.text(), env);
    assert.equal(env.window.count, code.startsWith('window') ? 1 : 0);
  }
});
async function adminRoute(service, authorized = true) {
  return loadModule('app/routes/app.settings.customization.jsx', {
    react: {}, 'react-router': {}, '@shopify/shopify-app-react-router/server': { boundary: {} },
    '../utils/customization.js': schema, '../services/customization.server.js': service, '../graphql/queries': { GET_THEME: 'themes' },
    '../shopify.server': { authenticate: { admin: async () => { if (!authorized) throw Error('Unauthorized'); return { session: { shop: 'owner' }, admin: { graphql: async () => ({ json: async () => ({ data: { themes: { edges: [{ node: { id: '1', name: 'Draft', role: 'UNPUBLISHED' } }, { node: { id: '2', name: 'Live', role: 'MAIN' } }] } } }) }) } }; } } },
  });
}
const actionRequest = values => ({ request: new Request('https://fixture/admin', { method: 'POST', body: new URLSearchParams(values) }) });
test('admin loads published theme by default and enforces authenticated shop/theme for save and reset', async () => {
  const { service } = await fixture(), route = await adminRoute(service);
  const loaded = await route.loader({ request: new Request('https://fixture/admin') }); assert.equal(loaded.themeId, '2');
  assert.ok((await route.action(actionRequest({ intent: 'save', themeId: '999', customization: JSON.stringify(defaults) }))).error);
  assert.ok((await route.action(actionRequest({ intent: 'save', themeId: '1', shop: 'attacker', customization: JSON.stringify({ ...defaults, css: 'saved' }) }))).success);
  assert.equal((await service.getCustomization('owner', '1')).css, 'saved'); assert.equal(await service.getCustomization('attacker', '1'), null);
  assert.ok((await route.action(actionRequest({ intent: 'reset', themeId: '1' }))).success);
  assert.equal(await service.getCustomization('owner', '1'), null);
  for (const values of [{ intent: 'save', themeId: '1', customization: '{}' }, { intent: 'save', themeId: '1', customization: 'bad' }, { intent: 'bad', themeId: '1' }]) assert.ok((await route.action(actionRequest(values))).error);
});
test('authentication failures propagate, and storage failures never expose server details', async () => {
  const { service } = await fixture(), unauthorized = await adminRoute(service, false);
  await assert.rejects(unauthorized.action(actionRequest({})), /Unauthorized/);
  await assert.rejects(unauthorized.loader({ request: new Request('https://fixture/admin') }), /Unauthorized/);
  const failing = await adminRoute({ ...service, saveCustomization: async () => { throw Error('private host/password details'); } });
  const result = await failing.action(actionRequest({ intent: 'save', themeId: '1', customization: JSON.stringify(defaults) }));
  assert.ok(result.error); assert.ok(!result.error.includes('private'));
});
const asset = await fs.readFile('extensions/theme-extension/assets/customization.js', 'utf8');
test('storefront requests are shared and bounded; missing/invalid/failed settings fail open', async () => {
  for (const outcome of ['missing', 'invalid', 'http', 'offline']) {
    let calls = 0, clears = 0;
    const env = { window: { cfpCustomizationContext: { shop: 'test.myshopify.com', themeId: '1' } }, location: { search: '' }, URL, URLSearchParams, AbortController,
      setTimeout: (_fn, delay) => { assert.equal(delay, 1500); return 1; }, clearTimeout: () => clears++,
      fetch: async () => { calls++; if (outcome === 'offline') throw Error(); return { ok: outcome !== 'http', json: async () => ({ customization: outcome === 'invalid' ? [] : null }) }; },
    };
    vm.createContext(env); vm.runInContext(asset, env); const first = env.window.cfpCustomizationReady;
    vm.runInContext(asset, env); assert.equal(first, env.window.cfpCustomizationReady);
    assert.equal(await first, null); assert.equal(calls, 1); assert.equal(clears, 1);
  }
});
test('bypass and missing theme cause no customization network request', async () => {
  for (const [search, context] of [['?cfp_disable_customization=1', { shop: 'test.myshopify.com', themeId: '1' }], ['', null]]) {
    const env = { window: { cfpCustomizationContext: context }, location: { search }, URLSearchParams, fetch: () => { throw Error('Must not fetch'); } };
    vm.runInNewContext(asset, env); assert.equal(await env.window.cfpCustomizationReady, null);
  }
});
