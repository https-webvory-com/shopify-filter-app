import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import Papa from 'papaparse';
import { loadModule } from './helpers/search-ranking.mjs';
import * as ordering from '../../app/utils/pinImportOrder.js';
import * as report from '../../app/utils/csvImportReport.js';

const plain = value => JSON.parse(JSON.stringify(value));
const shop = 'owner.myshopify.com';
const collectionId = 'gid://shopify/Collection/10';
const productId = id => `gid://shopify/Product/${id}`;
const original = (extra = {}) => ({
  id: 'original-rule', shop, ruleType: 'collection', name: 'Boost your confidence',
  collections: ['Military Ball Dresses'], collectionSortKey: '[10]', collectionSortPosition: 7,
  products: [{ id: productId(1), title: 'One', image: 'one.jpg' }, { id: productId(2), title: 'Two', image: 'two.jpg' }],
  status: true, applyToAll: false, searchQueries: [], applyToSearchType: 'both',
  createdAt: '2026-10-16T00:00:00.000Z', ...extra,
});

// Exercise the shipped exporter, CSV parser and modal row mapper, rather than
// constructing an API payload that could hide lost identity fields.
async function exportedRow(rule) {
  const source = await fs.readFile('app/components/merchandising/ExportCollectionPinsModal.jsx', 'utf8');
  let csv;
  const context = {
    sortPinningRules: ordering.sortPinningRules, allRules: [rule], selectedRuleIds: [rule.id],
    selectedFields: ['Active', 'Id', 'Collections', 'CollectionTitles', 'Products', 'SiteId'],
    Papa: { unparse: rows => { csv = Papa.unparse(plain(rows)); return csv; } }, Blob,
    URL: { createObjectURL: () => 'blob:test' },
    document: { createElement: () => ({ setAttribute() {}, style: {}, click() {} }), body: { appendChild() {}, removeChild() {} } },
    onClose() {},
  };
  vm.runInNewContext(source.slice(source.indexOf('  const extractNumericId'), source.indexOf('\n  return (')) + '\nhandleExport();', context);
  const parsed = Papa.parse(csv, { header: true });
  assert.deepEqual(parsed.errors, []);
  const mapper = await fs.readFile('app/components/merchandising/ImportCollectionPinsModal.jsx', 'utf8');
  const start = mapper.indexOf('function tryParse');
  const end = mapper.indexOf('\n//', mapper.indexOf('function mapCsvRow'));
  return plain(vm.runInNewContext(mapper.slice(start, end) + '\nmapCsvRow(row);', { row: parsed.data[0] }));
}

async function fixture(initial = [], { deleteDuringUpdate = false } = {}) {
  const saved = plain(initial), calls = [], invalidations = [];
  let serial = 0;
  const match = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const model = {
    findFirst: async ({ where }) => {
      assert.equal(where.shop, shop); assert.equal(where.ruleType, 'collection');
      calls.push(['lookup', plain(where)]);
      const found = saved.find(row => match(row, where));
      return found ? { id: found.id } : null;
    },
    update: async ({ where, data }) => {
      assert.equal(where.shop, shop); assert.equal(where.ruleType, 'collection');
      calls.push(['update', plain(where)]);
      const found = saved.find(row => match(row, where));
      if (!found || deleteDuringUpdate) throw Object.assign(Error('private database detail'), { code: 'P2025' });
      Object.assign(found, plain(data)); return found;
    },
    upsert: async ({ where, create, update }) => {
      const key = where.shop_name_ruleType;
      assert.equal(key.shop, shop); calls.push(['upsert', plain(key)]);
      const found = saved.find(row => match(row, key));
      if (found) { Object.assign(found, plain(update)); return found; }
      const created = { id: `new-${++serial}`, ...plain(create) }; saved.push(created); return created;
    },
  };
  const { action } = await loadModule('app/routes/api.import-pins-batch.jsx', {
    '../utils/pinImportOrder.js': ordering, '../utils/csvImportReport.js': report,
    '../shopify.server': { authenticate: { admin: async () => ({ session: { shop } }) } },
    '../db.server': { default: {
      pinnedProductRule: model,
      product: { findMany: async () => [1, 2].map(id => ({ id: productId(id), title: String(id), images: [] })) },
      collection: { findMany: async () => [{ id: collectionId, title: 'Military Ball Dresses' }] },
    } },
    '../services/shopCache.server.js': { invalidateShop: async value => invalidations.push(value) },
  });
  const send = async (rows, ruleType = 'collection') => (await action({ request: new Request('https://fixture/api/import-pins-batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, ruleType }),
  }) })).json();
  return { saved, calls, invalidations, send };
}

test('actual collection CSV roundtrip updates a custom-named rule by ID, repeatedly, without a duplicate', async () => {
  const before = original();
  const other = original({ id: 'other-rule', name: 'Military Ball Dresses' });
  const f = await fixture([before, other]);
  const row = await exportedRow({ ...before, status: false, products: [...before.products].reverse() });
  const ordered = ordering.orderedPinImportRows([row]);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.send(ordered);
    assert.equal(result.imported, 1); assert.equal(result.skipped, 0);
    assert.equal(f.saved.length, 2);
    const updated = f.saved.find(rule => rule.id === before.id);
    assert.equal(updated.name, before.name);
    assert.equal(updated.createdAt, before.createdAt);
    assert.equal(updated.collectionSortPosition, 7);
    assert.equal(updated.collectionSortKey, '[10]');
    assert.equal(updated.status, false);
    assert.equal(updated.importOrder, ordered[0].importOrder);
    assert.deepEqual(updated.products.map(p => p.id), [productId(2), productId(1)]);
    assert.deepEqual(updated.products.map(p => p.imageUrl), ['two.jpg', 'one.jpg']);
    assert.deepEqual(f.saved.find(rule => rule.id === other.id), other);
  }
  assert.equal(f.calls.filter(([kind]) => kind === 'upsert').length, 0);
  assert.deepEqual(f.invalidations, [shop, shop]);
});

test('exported IDs still match after both the rule and collection titles change', async () => {
  const row = await exportedRow(original({ collections: ['Old collection title'] }));
  const f = await fixture([original({ name: 'Renamed rule' })]);
  const result = await f.send([row]);
  assert.equal(result.imported, 1); assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].name, 'Renamed rule');
  assert.deepEqual(f.saved[0].collections, ['Military Ball Dresses']);
});

for (const foreign of [{ shop: 'other.myshopify.com' }, { ruleType: 'search' }]) {
  test(`foreign identity cannot overwrite a rule outside ${JSON.stringify(foreign)}`, async () => {
    const untouched = original(foreign);
    const f = await fixture([untouched]);
    const row = await exportedRow(original({ products: [original().products[1]] }));
    for (let attempt = 0; attempt < 2; attempt++) assert.equal((await f.send([row])).imported, 1);
    assert.equal(f.saved.length, 2, 'foreign imports remain repeatable by name');
    assert.deepEqual(f.saved[0], untouched);
    assert.equal(f.saved[1].shop, shop); assert.equal(f.saved[1].ruleType, 'collection');
    assert.equal(f.saved[1].name, 'Military Ball Dresses');
    assert.deepEqual(f.saved[1].products.map(p => p.id), [productId(2)]);
    assert.equal(f.calls.filter(([kind]) => kind === 'update').length, 0);
  });
}

test('legacy CSV without an ID keeps the existing name-based update behavior', async () => {
  const f = await fixture([original({ name: 'Military Ball Dresses' })]);
  const row = await exportedRow(original()); delete row.externalId;
  row.active = false;
  assert.equal((await f.send([row])).imported, 1);
  assert.equal(f.saved.length, 1); assert.equal(f.saved[0].status, false);
  assert.equal(f.calls[0][0], 'upsert');
});

test('invalid reimports preserve the original rule and never invalidate the storefront', async () => {
  const before = original(); const f = await fixture([before]);
  const row = await exportedRow(before);
  const result = await f.send([{ ...row, products: [{ Id: '999' }] }, { ...row, collectionIds: ['999'] }]);
  assert.equal(result.imported, 0); assert.equal(result.skipped, 2);
  assert.deepEqual(f.saved, [before]); assert.deepEqual(f.calls, []); assert.deepEqual(f.invalidations, []);
});

test('a rule deleted between identity lookup and update reports failure without creating a replacement', async () => {
  const before = original(); const f = await fixture([before], { deleteDuringUpdate: true });
  const result = await f.send([await exportedRow(before)]);
  assert.equal(result.imported, 0); assert.equal(result.skipped, 1);
  assert.match(result.errors[0].reason, /changed or was deleted/);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(f.calls.filter(([kind]) => kind === 'upsert').length, 0);
  assert.deepEqual(f.saved, [before]); assert.deepEqual(f.invalidations, []);
});
