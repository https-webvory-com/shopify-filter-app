import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { loadModule } from './helpers/search-ranking.mjs';
import * as schema from '../../app/utils/searchSettings.js';
import * as blacklist from '../../app/utils/suggestionBlacklist.js';

const { DEFAULT_SEARCH_SETTINGS: defaults, validateSearchSettings: validate, SEARCH_SETTING_FIELDS: fields } = schema;
const plain = value => JSON.parse(JSON.stringify(value));
test('defaults validate and unknown properties cannot become persisted controls', () => {
  assert.deepEqual(validate({ ...defaults, shop: 'other', dangerous: true }), defaults);
  for (const invalid of [null, [], 'settings', {}]) assert.throws(() => validate(invalid));
});
for (const [key, [, fallback, min, max]] of Object.entries(fields)) {
  test(`${key} rejects incorrect types and accepts supported boundaries`, () => {
    for (const value of [null, undefined, 'true', '1', [], {}]) assert.throws(() => validate({ ...defaults, [key]: value }));
    if (typeof fallback === 'boolean') {
      for (const value of [true, false]) assert.equal(validate({ ...defaults, [key]: value })[key], value);
      assert.throws(() => validate({ ...defaults, [key]: 0 }));
    } else {
      for (const value of [min, max]) assert.equal(validate({ ...defaults, [key]: value })[key], value);
      for (const value of [min - 1, max + 1, 1.5, NaN, Infinity]) assert.throws(() => validate({ ...defaults, [key]: value }));
    }
  });
}
test('manual suggestions normalize, preserve order, deduplicate, and enforce limits', () => {
  assert.deepEqual(validate({ ...defaults, manualSuggestions: ['  Blue   Dress ', 'blue dress', 'Ｒｅｄ'] }).manualSuggestions, ['Blue Dress', 'Red']);
  for (const value of ['dress', [null], [''], ['a'.repeat(101)], ['bad\nterm'], Array(11).fill('dress')]) assert.throws(() => validate({ ...defaults, manualSuggestions: value }));
  assert.equal(validate({ ...defaults, manualSuggestions: ['<script>'] }).manualSuggestions[0], '<script>'); // Escaped at render time, never treated as HTML.
});

async function serviceFixture() {
  const rows = new Map();
  const service = await loadModule('app/services/searchSettings.server.js', {
    '../db.server': { default: { searchSetting: {
      findUnique: async ({ where }) => rows.get(where.shop) || null,
      upsert: async ({ where, create, update }) => rows.set(where.shop, rows.has(where.shop) ? { ...rows.get(where.shop), ...update } : create),
      deleteMany: async ({ where }) => rows.delete(where.shop),
    } } }, '../utils/searchSettings.js': schema,
  });
  return { rows, service };
}
test('settings persist by authenticated shop; reset deletes only that shop', async () => {
  const { service, rows } = await serviceFixture();
  assert.equal(await service.getSearchSettings('a'), null);
  await service.saveSearchSettings('a', { ...defaults, productLimit: 10 });
  await service.saveSearchSettings('b', { ...defaults, productLimit: 2 });
  assert.equal((await service.getSearchSettings('a')).productLimit, 10);
  await service.saveSearchSettings('a', { ...defaults, productLimit: 8 });
  assert.equal((await service.getSearchSettings('a')).productLimit, 8);
  await assert.rejects(service.saveSearchSettings('a', { ...defaults, pageSize: 0 }));
  assert.equal(rows.get('a').config.pageSize, 25);
  await service.resetSearchSettings('a');
  assert.equal(await service.getSearchSettings('a'), null);
  assert.equal((await service.getSearchSettings('b')).productLimit, 2);
});

const data = (body, options) => new Response(JSON.stringify(body), { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
async function publicRoute(read, rules = async () => [], allowed = true) {
  return loadModule('app/routes/api.search-settings.jsx', {
    'react-router': { data }, '../services/searchSettings.server.js': { getSearchSettings: read },
    '../services/suggestionBlacklist.server.js': { getActiveSuggestionBlacklist: rules },
    '../utils/suggestionBlacklist.js': blacklist, '../services/rateLimiter.server': { rateLimit: async () => allowed },
  });
}
const request = shop => ({ request: new Request('https://fixture/api/search-settings?shop=' + encodeURIComponent(shop)) });
test('public settings validate shop, rate limit, use no-store and filter manual blacklist', async () => {
  let calls = 0;
  const route = await publicRoute(async shop => { calls++; assert.equal(shop, 'test.myshopify.com'); return { ...defaults, manualSuggestions: ['Blue Dress', 'Red Dress', 'Green'] }; }, async () => [{ term: 'blue', operator: 'contains' }, { term: 'red dress', operator: 'exact' }]);
  for (const shop of ['', 'https://test.myshopify.com', 'test.myshopify.com.evil', '../test']) assert.equal((await route.loader(request(shop))).status, 400);
  assert.equal(calls, 0);
  const response = await route.loader(request('test.myshopify.com'));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await response.json()).settings.manualSuggestions, ['Green']);
  const limited = await publicRoute(() => { throw Error('must not read'); }, undefined, false);
  assert.equal((await limited.loader(request('test.myshopify.com'))).status, 429);
});
test('missing or unavailable settings preserve defaults; unavailable blacklist suppresses manual suggestions only', async () => {
  for (const read of [async () => null, async () => { throw Error('offline'); }]) {
    const route = await publicRoute(read);
    assert.deepEqual(await (await route.loader(request('test.myshopify.com'))).json(), { settings: null });
  }
  const route = await publicRoute(async () => ({ ...defaults, manualSuggestions: ['Blue'] }), async () => { throw Error('offline'); });
  const result = (await (await route.loader(request('test.myshopify.com'))).json()).settings;
  assert.equal(result.productLimit, 6); assert.deepEqual(result.manualSuggestions, []);
});
test('admin uses session shop for reads, saves and reset, rejects invalid input and handles write failures', async () => {
  const { service } = await serviceFixture();
  const route = await loadModule('app/routes/app.search.settings.jsx', {
    '../components/SearchConfigurationLayout': { default: () => null }, 'react-router': {}, react: {}, '@shopify/shopify-app-react-router/server': { boundary: {} },
    '../shopify.server': { authenticate: { admin: async () => ({ session: { shop: 'session-shop' } }) } },
    '../services/searchSettings.server.js': service, '../utils/searchSettings.js': schema,
  });
  const action = values => route.action({ request: new Request('https://fixture/admin', { method: 'POST', body: new URLSearchParams(values) }) });
  assert.ok((await action({ intent: 'save', settings: 'bad' })).error);
  assert.ok((await action({ intent: 'save', settings: JSON.stringify({ ...defaults, pageSize: 0 }) })).error);
  assert.ok((await action({ intent: 'delete' })).error);
  assert.ok((await action({ intent: 'save', shop: 'attacker', settings: JSON.stringify({ ...defaults, pageSize: 12 }) })).success);
  assert.equal((await route.loader({ request: new Request('https://fixture/admin') })).settings.pageSize, 12);
  assert.equal(await service.getSearchSettings('attacker'), null);
  assert.ok((await action({ intent: 'reset' })).success);
  assert.equal((await route.loader({ request: new Request('https://fixture/admin') })).settings, null);
});

const asset = await fs.readFile('extensions/theme-extension/assets/searchSettings.js', 'utf8');
test('admin authentication failures escape and write failures return safe messages', async () => {
  let writes = 0;
  let authorized = false;
  const route = await loadModule('app/routes/app.search.settings.jsx', {
    '../components/SearchConfigurationLayout': { default: () => null }, 'react-router': {}, react: {}, '@shopify/shopify-app-react-router/server': { boundary: {} },
    '../shopify.server': { authenticate: { admin: async () => { if (!authorized) throw Error('Unauthorized'); return { session: { shop: 'session-shop' } }; } } },
    '../services/searchSettings.server.js': { getSearchSettings: async () => null, saveSearchSettings: async () => { writes++; throw Error('private connection detail'); }, resetSearchSettings: async () => { writes++; throw Error('private connection detail'); } },
    '../utils/searchSettings.js': schema,
  });
  const request = intent => ({ request: new Request('https://fixture/admin', { method: 'POST', body: new URLSearchParams({ intent, settings: JSON.stringify(defaults) }) }) });
  await assert.rejects(route.action(request('save')), /Unauthorized/);
  await assert.rejects(route.loader({ request: new Request('https://fixture/admin') }), /Unauthorized/);
  assert.equal(writes, 0);
  authorized = true;
  for (const intent of ['save', 'reset']) {
    const result = await route.action(request(intent));
    assert.ok(result.error); assert.ok(!result.error.includes('private'));
  }
  assert.equal(writes, 2);
});
test('storefront bootstrap is shared, bounded, and fails open', async () => {
  for (const outcome of ['valid', 'missing', 'error', 'http', 'invalid']) {
    let calls = 0, clears = 0;
    const context = { window: { Shopify: { shop: 'test.myshopify.com' } }, AbortController, encodeURIComponent,
      setTimeout: (_fn, delay) => { assert.equal(delay, 1500); return 1; }, clearTimeout: () => clears++,
      fetch: async () => { calls++; if (outcome === 'error') throw Error('offline'); return { ok: outcome !== 'http', json: async () => ({ settings: outcome === 'valid' ? defaults : outcome === 'invalid' ? [] : null }) }; },
    };
    vm.createContext(context); vm.runInContext(asset, context); const first = context.window.cfpSearchSettingsReady;
    vm.runInContext(asset, context); assert.equal(first, context.window.cfpSearchSettingsReady);
    const result = await first;
    assert.equal(calls, 1); assert.equal(clears, 1);
    assert.deepEqual(plain(result), outcome === 'valid' ? defaults : null);
  }
});

test('next-action settings refresh shares pending reads and clears prior values after reset',async()=>{
  let saved=defaults,calls=0;
  const context={window:{Shopify:{shop:'test.myshopify.com'}},AbortController,encodeURIComponent,setTimeout,clearTimeout,
    fetch:async(_url,options)=>{calls++;assert.equal(options.cache,'no-store');return {ok:true,json:async()=>({settings:saved})};},
  };
  vm.createContext(context);vm.runInContext(asset,context);
  await context.window.cfpSearchSettingsReady;
  assert.deepEqual(plain(context.window.cfpSearchSettings),defaults);
  saved=null;
  const first=context.window.cfpRefreshSearchSettings(),second=context.window.cfpRefreshSearchSettings();
  assert.equal(first,second);await first;
  assert.equal(calls,2);assert.equal(context.window.cfpSearchSettings,null);
});

test('legacy instant-search disable flags are ignored on read and removed on save without resetting other settings', async () => {
  const {rows,service}=await serviceFixture();
  rows.set('legacy',{config:{...defaults,instantEnabled:false,productLimit:3,manualSuggestions:['Blue dress']}});
  const loaded=await service.getSearchSettings('legacy');
  assert.equal(Object.hasOwn(loaded,'instantEnabled'),false);assert.equal(loaded.productLimit,3);
  assert.deepEqual(loaded.manualSuggestions,['Blue dress']);
  await service.saveSearchSettings('legacy',{...loaded,instantEnabled:false,pageSize:12});
  assert.equal(Object.hasOwn(rows.get('legacy').config,'instantEnabled'),false);
  assert.equal(rows.get('legacy').config.productLimit,3);assert.equal(rows.get('legacy').config.pageSize,12);
});

const instant = await fs.readFile('extensions/theme-extension/assets/instantSearch.js', 'utf8');
function recentFixture(config, storageValue = '[]') {
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, { style: {}, innerHTML: '', querySelectorAll: () => [] }); return elements.get(id); };
  const context = { CONFIG: config, document: { getElementById: element }, localStorage: { getItem: () => storageValue, setItem: (_k, v) => { storageValue = v; } } };
  vm.createContext(context);
  vm.runInContext(instant.slice(instant.indexOf('  function highlightSearchText'), instant.indexOf('  // UI Elements')) + instant.slice(instant.indexOf('  function saveRecentSearch'), instant.indexOf('  function openModal')) + instant.slice(instant.indexOf('  function renderRecentSearches'), instant.indexOf('  async function performSearch')), context);
  return { context, element, stored: () => JSON.parse(storageValue) };
}
test('manual suggestions render in order as escaped search links; zero suggestions hide typed section', () => {
  const f = recentFixture({ manualSuggestions: ['<script>', 'Blue Dress'], suggestionLimit: 0 });
  f.context.renderRecentSearches('');
  const html = f.element('cfp-recent-searches-list').innerHTML;
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>'));
  assert.ok(html.indexOf('&lt;script&gt;') < html.indexOf('Blue Dress'));
  f.context.renderSuggestions(['Blue'], 'blue');
  assert.equal(f.element('cfp-recent-searches-container').style.display, 'none');
});
test('recent count, malformed storage, blocked storage, removal and escaping', () => {
  const f = recentFixture({ recentLimit: 2 }, '["<img>","Blue","Red"]');
  f.context.renderRecentSearches('');
  assert.ok(f.element('cfp-recent-searches-list').innerHTML.includes('&lt;img&gt;'));
  assert.ok(!f.element('cfp-recent-searches-list').innerHTML.includes('Red'));
  f.context.saveRecentSearch('New'); assert.deepEqual(f.stored(), ['New', '<img>']);
  f.context.removeRecentSearch('New'); assert.deepEqual(f.stored(), ['<img>']);
  const malformed = recentFixture({}, '{}'); assert.deepEqual(plain(malformed.context.readRecentSearches()), []);
  const blocked = recentFixture({ recentLimit: 0 });
  blocked.context.localStorage.getItem = () => { throw Error('blocked'); };
  blocked.context.localStorage.setItem = () => { throw Error('blocked'); };
  assert.doesNotThrow(() => blocked.context.renderRecentSearches(''));
  assert.doesNotThrow(() => blocked.context.saveRecentSearch('Blue'));
  assert.doesNotThrow(() => blocked.context.removeRecentSearch('Blue'));
});
