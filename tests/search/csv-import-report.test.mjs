import * as pinImportOrder from "../../app/utils/pinImportOrder.js";
import {merchandisingRuleIds} from "../../app/utils/merchandisingSelection.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as reportHelpers from '../../app/utils/csvImportReport.js';
import * as conditions from '../../app/utils/merchandisingCondition.js';
import * as marketRuleCountries from '../../app/utils/marketRuleCountries.js';
import * as merchandisingMarketInvalidation from '../../app/utils/merchandisingMarketInvalidation.js';
import { postPinImportBatch, unconfirmedPinRows } from '../../app/utils/pinImportBatch.js';
const plain = value => JSON.parse(JSON.stringify(value));
export async function loadImportModule(file, mocks) {
  const code = (await transform((await fs.readFile(file, 'utf8')).replaceAll('await import("../services/shopCache.server")', '({invalidateShop: async()=>{}})'), { loader: file.endsWith('jsx') ? 'jsx' : 'js', format: 'cjs' })).code;
  const context = { module: { exports: {} }, exports: {}, Response, URL, console: { error() {} }, require(name) {
      if (name === "../utils/pinImportOrder.js") return pinImportOrder;
    if (name === "../utils/merchandisingSelection.js") return {merchandisingRuleIds};
    if (name in mocks) return mocks[name];
    if (name === '../utils/csvImportReport.js') return reportHelpers;
    if (name === '../utils/merchandisingCondition.js') return conditions;
    if (name === '../utils/marketRuleCountries.js') return marketRuleCountries;
    if (name === '../utils/merchandisingMarketInvalidation.js') return merchandisingMarketInvalidation;
    if (name.startsWith('../components/') || ['react', 'react-router', '@shopify/app-bridge-react', '@shopify/shopify-app-react-router/server', '../services/searchPicker.server.js'].includes(name)) return {};
    throw Error('Unexpected import ' + name);
  } };
  vm.runInNewContext(code, context); return context.module.exports;
}
export async function merchandisingFixture() {
  let rows = [], serial = 0;
  const model = {
    findFirst: async ({ where }) => rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) || null,
    create: async ({ data }) => { if (data.name === 'database failure') throw Object.assign(Error('private database secret'), { code: 'P2000' }); const row = { id: String(++serial), ...plain(data) }; rows.push(row); return row; },
    update: async ({ where, data }) => { if (data.conditions.create.some(c => c.value === 'FAIL')) throw Object.assign(Error('private connection secret'), { code: 'P2000' }); Object.assign(rows.find(r => r.id === where.id), plain(data)); },
  };
  const collection = { findMany: async () => [{ id: 'gid://shopify/Collection/1', title: 'Summer' }] };
  const prisma = { merchandisingRule: model, collection, $transaction: async fn => { const snapshot = plain(rows); try { return await fn({ merchandisingRule: model, collection }); } catch (e) { rows = snapshot; throw e; } } };
  const service = await loadImportModule('app/services/merchandisingImport.server.js', { '../db.server': { __esModule: true, default: prisma } });
  return { service, prisma, rows: () => rows };
}
const rule = (name, extra = {}) => ({ name, sourceName: name, sourceRow: 2, collections: ['Summer'], searchQueries: ['dress'], conditions: [{ action: 'Boost', field: 'Tags', value: 'Summer' }], ...extra });
test('merchandising imports retain fractional and negative ordinals across updates and both scopes', async () => {
  for (const scope of ['search', 'collection']) {
    const f = await merchandisingFixture();
    const inputs = [rule('Plus Size', { ordinal: '-0.25' }), rule('Wedding', { ordinal: '-0.375' }), rule('MOB', { ordinal: '-1' }), rule('Prom', { ordinal: '-0.5' }), rule('Formal', { ordinal: '0' }), rule('Graduation', { ordinal: '18.25' })];
    assert.equal((await f.service.importMerchandisingRules('owner', inputs, scope)).imported, 6);
    assert.deepEqual(reportHelpers.sortMerchandisingRules(f.rows()).map(r => r.name), ['MOB', 'Prom', 'Wedding', 'Plus Size', 'Formal', 'Graduation']);
    await f.service.importMerchandisingRules('owner', [rule('MOB')], scope);
    assert.equal(f.rows().find(r => r.name === 'MOB').ordinal, -1);
    await f.service.importMerchandisingRules('owner', [rule('MOB', { ordinal: 22 })], scope);
    assert.equal(f.rows().length, 6);
    assert.equal(reportHelpers.sortMerchandisingRules(f.rows()).at(-1).name, 'MOB');
    assert.deepEqual(f.rows().find(r => r.name === 'Prom').searchQueries, ['dress']);
  }
});
test('invalid ordinals are reported without overwriting existing merchandising rules', async () => {
  const f = await merchandisingFixture();
  await f.service.importMerchandisingRules('owner', [rule('saved', { ordinal: -1 })], 'search');
  const before = plain(f.rows());
  for (const ordinal of [null, true, '', ' ', 'bad', 'Infinity', {}, [], Infinity, NaN]) {
    const result = await f.service.importMerchandisingRules('owner', [rule('saved', { ordinal })], 'search');
    assert.equal(result.skipped, 1); assert.match(result.errors[0].reason, /Ordinal/);
  }
  assert.deepEqual(f.rows(), before);
});
test('merchandising admin loaders use numeric ordinal ascending with legacy rules last', async () => {
  for (const scope of ['search', 'collections']) {
    const source = await fs.readFile(`app/routes/app.${scope}.merchandising.jsx`, 'utf8');
    assert.match(source, /orderBy: \[\{ ordinal: \{ sort: "asc", nulls: "last" \} \}, \{ createdAt: "desc" \}\]/);
  }
  const legacy = { name: 'legacy', createdAt: '2026-10-16' };
  const input = [legacy, { name: 'same1', ordinal: 0 }, { name: 'same2', ordinal: 0 }, { name: 'first', ordinal: -1 }];
  assert.deepEqual(reportHelpers.sortMerchandisingRules(input).map(r => r.name), ['first', 'same1', 'same2', 'legacy']);
  assert.equal(input[0], legacy);
});
test('CSV metadata retains rule names/rows and reports malformed arrays instead of silently widening scope', () => {
  const row = { Name: 'Summer', Conditions: '[]', CollectionTitles: '{bad', SearchQueries: '[]' };
  const value = reportHelpers.csvRowMetadata(row, 7, 'merchandising');
  assert.equal(value.sourceRow, 9); assert.equal(value.sourceName, 'Summer'); assert.match(value.importError, /CollectionTitles.*JSON/);
  assert.match(reportHelpers.csvRowMetadata({ Products: '{}' }, 0, 'pinning').importError, /Products/);
  assert.match(reportHelpers.csvRowMetadata({}, 0, 'merchandising').importError, /name.*missing/);
  assert.match(reportHelpers.csvRowMetadata({ Products: '[]' }, 0, 'pinning', [{ row: 0, message: 'Too many fields' }]).importError, /Too many fields/);
});
test('grouped condition rows report merging, keep parse failures, and safely handle special names', () => {
  const values = reportHelpers.groupMerchandisingImports([rule('__proto__'), rule('__proto__', { sourceRow: 3, importError: 'Conditions JSON invalid' }), rule('Other')]);
  assert.equal(values.length, 2); assert.equal(values[0].conditions.length, 2); assert.deepEqual(values[0].sourceRows, [2, 3]); assert.match(values[0].importError, /row 3/);
  assert.doesNotThrow(() => reportHelpers.groupMerchandisingImports([rule('broken', { collections: {}, searchQueries: null, conditions: {} })]));
});
test('merchandising mixed imports save valid rules and explain every skipped rule', async () => {
  const f = await merchandisingFixture();
  const result = await f.service.importMerchandisingRules('owner', [rule('valid'), rule('bad json', { importError: 'Conditions must contain valid JSON', sourceRow: 3 }), rule('bad date', { startDate: 'invalid', sourceRow: 4 }), rule('database failure', { sourceRow: 5 }), rule('valid after failure', { sourceRow: 6 })], 'collection');
  assert.equal(result.imported, 2); assert.equal(result.skipped, 3); assert.deepEqual(plain(result.errors.map(e => e.row)), [3, 4, 5]);
  assert.ok(result.errors.every(e => e.name && e.reason)); assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(f.rows().length, 2);
});
test('failed merchandising replacement preserves existing rule and cannot cross search/collection/shop scope', async () => {
  const f = await merchandisingFixture();
  for (const [shop, type] of [['owner', 'search'], ['owner', 'collection'], ['other', 'collection']]) await f.service.importMerchandisingRules(shop, [rule('same')], type);
  const before = plain(f.rows());
  const report = await f.service.importMerchandisingRules('owner', [rule('same', { conditions: [{ action: 'Boost', field: 'Tags', value: 'FAIL' }] })], 'collection');
  assert.equal(report.skipped, 1); assert.deepEqual(f.rows(), before);
  const changed = await f.service.importMerchandisingRules('owner', [rule('same', { conditions: [{ action: 'Boost', field: 'Price', minValue: 0, maxValue: 0 }] })], 'collection');
  assert.equal(changed.imported, 1); assert.match(changed.warnings[0].reason, /updated/); assert.equal(f.rows().length, 3);
  assert.equal(f.rows().find(r => r.shop === 'owner' && r.ruleType === 'collection').conditions.create[0].maxValue, '0');
});
test('invalid names, ranges, conditions, actions and malformed arrays receive actionable reasons', async () => {
  const f = await merchandisingFixture();
  const bad = [null, rule('x', { name: 2 }), rule('x', { conditions: [] }), rule('x', { conditions: [{ action: 'Boost', field: 'Price', minValue: 10, maxValue: 1 }] }), rule('x', { conditions: [{ action: 'Unsupported', field: 'Tags', value: 'x' }] }), rule('x', { collections: {} }), rule('x', { startDate: '2026-10-20', endDate: '2026-10-10' })];
  const result = await f.service.importMerchandisingRules('owner', bad, 'search');
  assert.equal(result.skipped, bad.length); assert.equal(result.errors.length, bad.length); assert.equal(f.rows().length, 0); assert.match(result.errors[4].reason, /Unsupported/);
});
test('both merchandising actions return partial reports instead of aborting the entire file', async () => {
  for (const type of ['collections', 'search']) {
    const f = await merchandisingFixture();
    const route = await loadImportModule(`app/routes/app.${type}.merchandising.jsx`, {
      '../services/shopCache.server': { invalidateShop: async () => {} },
      '../services/merchandisingImport.server.js': f.service, '../db.server': { __esModule: true, default: f.prisma },
      '../shopify.server': { authenticate: { admin: async () => ({ session: { shop: 'owner' } }) } },
    });
    const send = rules => route.action({ request: new Request('https://fixture/admin', { method: 'POST', body: new URLSearchParams({ actionType: 'importRules', rules }) }) });
    const body = await (await send(JSON.stringify([rule('valid'), rule('broken', { conditions: [] })]))).json();
    assert.equal(body.count, 1); assert.equal(body.skipped, 1); assert.equal(body.errors[0].name, 'broken');
    assert.equal((await send('not json')).status, 400);
  }
});
export async function pinFixture({ offline = false } = {}) {
  const writes = [];
  const route = await loadImportModule('app/routes/api.import-pins-batch.jsx', {
    '../shopify.server': { authenticate: { admin: async () => ({ session: { shop: 'owner' } }) } },
    '../services/shopCache.server.js': { invalidateShop: async () => {} },
    '../db.server': { __esModule: true, default: {
      product: { findMany: async () => { if (offline) throw Error('private database secret'); return [{ id: 'gid://shopify/Product/1', title: 'Dress', images: [] }]; } },
      collection: { findMany: async () => [{ id: 'gid://shopify/Collection/1', title: 'Summer' }] },
      pinnedProductRule: { upsert: async arg => { writes.push(arg); } },
    } },
  });
  const send = (rows, ruleType = 'collection') => route.action({ request: new Request('https://fixture/api/import-pins-batch', { method: 'POST', body: JSON.stringify({ rows, ruleType }), headers: { 'Content-Type': 'application/json' } }) });
  return { send, writes };
}
test('pinning reports missing products, collections and invalid CSV per original rule/row', async () => {
  const f = await pinFixture();
  const body = await (await f.send([
    { sourceName: 'Good', products: [{ Id: '1' }], collectionTitles: ['Summer'], sourceRow: 2 },
    { sourceName: 'Missing product', products: [{ Id: '999' }], sourceRow: 3 },
    { sourceName: 'Missing collection', products: [{ Id: '1' }], collectionTitles: ['Gone'], sourceRow: 4 },
    { sourceName: 'Invalid row', products: {}, sourceRow: 5 },
    null,
  ])).json();
  assert.equal(body.imported, 1); assert.equal(body.skipped, 4); assert.equal(body.errors.length, 4);
  assert.equal(body.errors[0].row, 3); assert.match(body.errors[0].reason, /another Shopify store/); assert.match(body.errors[1].reason, /Collection/); assert.equal(f.writes.length, 1);
});
test('partially missing pins/targets produce warnings and search rules without queries are skipped safely', async () => {
  const f = await pinFixture();
  const partial = await (await f.send([{ sourceName: 'Partial', products: [{ Id: '1' }, { Id: '999' }], collectionTitles: ['Summer', 'Gone'] }])).json();
  assert.equal(partial.imported, 1); assert.equal(partial.warnings.length, 2);
  const search = await (await f.send([{ products: [{ Id: '1' }], searchQueries: [], applyToAll: false }], 'search')).json();
  assert.equal(search.skipped, 1); assert.match(search.errors[0].reason, /Search queries/);
});
test('pinning batch failures do not expose database details', async () => {
  const f = await pinFixture({ offline: true }); const response = await f.send([{ products: [{ Id: '1' }] }]);
  assert.equal(response.status, 500); assert.ok(!(await response.text()).includes('private'));
});
test('failed or incomplete HTTP batches are unconfirmed for every original row, not silently lost', async t => {
  const rows = [{ sourceRow: 52, sourceName: 'Rule 51' }, { sourceRow: 53, sourceName: 'Rule 52' }];
  for (const value of [new Response('offline', { status: 503 }), Response.json({ imported: 1, skipped: 0, errors: [] }), new Response('html')]) {
    t.mock.method(globalThis, 'fetch', async () => value);
    await assert.rejects(postPinImportBatch(rows, 'search'));
    t.mock.restoreAll();
  }
  const errors = unconfirmedPinRows(rows, Error('Network unavailable'));
  assert.deepEqual(errors.map(e => e.row), [52, 53]); assert.ok(errors.every(e => e.status === 'unconfirmed'));
});
test('successful batch summaries reconcile counts and include warnings', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ imported: 1, skipped: 1, errors: [{ row: 3, name: 'bad', reason: 'Missing products' }], warnings: [] }));
  const result = await postPinImportBatch([{}, {}], 'collection'); assert.equal(result.skipped, 1);
  assert.equal(reportHelpers.importSummary({ imported: 8, skipped: 2, unconfirmed: 1, warnings: [{}] }), '8 imported, 2 skipped, 1 unconfirmed, 1 warning(s).');
});
