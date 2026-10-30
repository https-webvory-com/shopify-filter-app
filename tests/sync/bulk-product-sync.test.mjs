import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

const shop = 'fixture.myshopify.com';
const active = { id: 'gid://shopify/Product/1', status: 'ACTIVE', publishedAt: '2026-10-01', collections: { nodes: [] } };
const draft = { id: 'gid://shopify/Product/2', status: 'DRAFT', publishedAt: null, collections: { nodes: [] } };

async function fixture({ indexFails = false } = {}) {
  const writes = [], indexed = [], checks = [];
  const job = { id: 'bulk-job', shop, kind: 'BULK_PRODUCTS', status: 'IN_PROGRESS', cursor: 'gid://shopify/BulkOperation/7', productsProcessed: 0 };
  const prisma = { syncJob: {
    findUnique: async () => job,
    update: async ({ data }) => { writes.push(data); Object.assign(job, data); return job; },
  } };
  const index = { addDocuments: async docs => { if (indexFails) throw Error('index unavailable'); indexed.push(...docs); return { taskUid: 1 }; } };
  const bulk = { bulkProductIndexStatus: async () => ({ status: 'complete', url: 'https://storage.test/file', count: 2, objectCount: 2 }),
    streamBulkProductIndex: async ({ onRoot, onProduct, skip }) => {
      for (const [offset, product] of [active, draft].entries()) {
        await onRoot(product, offset + 1);
        if (offset + 1 > skip) await onProduct(product, offset + 1);
      }
      return 2;
    } };
  const drift = { missing: [], extra: [], statusMismatch: [] };
  const audit = { auditCatalogDrift: async ({ bulkProducts }) => { checks.push(bulkProducts.map(p => p.id)); return drift; },
    auditSearchIndexDrift: async ({ bulkProducts }) => { checks.push(bulkProducts.map(p => p.id)); return drift; } };
  const source = (await fs.readFile('app/services/sync.server.js', 'utf8'))
    .replace("await import('./shopifyBulkIndex.server.js')", 'bulk')
    .replace("await import('./shopifyBulkCatalog.server.js')", 'audit')
    .replace("await import('./orders.server.js')", 'orders')
    .replace("await syncProductPayload(shop, admin, product.id, product, { retrySearchErrors: true, deferIndex: true })", 'await fakePayload(product)')
    .replaceAll('await autoSeedOptionFilters(shop)', 'await pretendSeed(shop)')
    .replaceAll('await updateMeiliSettings(shop, { throwOnError: true })', 'await pretendSettings(shop)');
  const mocks = {
    '../db.server': { __esModule: true, default: prisma },
    './meiliClient.server': { __esModule: true, default: { index: () => index, tasks: { waitForTask: async () => ({ status: 'succeeded' }) } } },
    './shopCache.server': { invalidateShop: async () => {} },
    './productCollections.server.js': { verifyMembershipWrites: async (_db, _index, _shop, products, docs) => {
      assert.equal(products.length, docs.length);
      assert.equal(docs[0].id, '1');
    } },
    '../utils/storefrontProduct.js': { isStorefrontProduct: p => p.status === 'ACTIVE' && !!p.publishedAt },
    '../utils/searchIndexProjection.js': { searchIndexProjection: () => ({}) },
    './collectionRuleFacts.server.js': { withCollectionRuleFacts: async docs => docs },
    './searchIndex.server.js': { scheduleSearchIndexProducts: async () => {} },
  };
  const ctx = { module: { exports: {} }, exports: {}, require: name => mocks[name] || {}, bulk, audit,
    orders: { syncHistoricalOrders: async () => true }, fakePayload: async product => product === draft ? null :
      { product, meiliDoc: { id: '1', shop, status: 'ACTIVE', collections: [] } },
    pretendSeed: async () => {}, pretendSettings: async () => {}, console: { log() {} }, process: { env: {} } };
  vm.runInNewContext((await transform(source, { format: 'cjs' })).code, ctx);
  return { run: () => ctx.module.exports.runBulkProductSync(job.id, shop, {}), job, writes, indexed, checks };
}

test('bulk sync commits complete batches, excludes drafts, verifies both stores and completes', async () => {
  const f = await fixture();
  const result = await f.run();
  assert.equal(result.status, 'complete');
  assert.equal(f.job.productsProcessed, 2);
  assert.equal(f.job.status, 'COMPLETED');
  assert.deepEqual(f.indexed.map(doc => doc.id), ['1']);
  assert.deepEqual(JSON.parse(JSON.stringify(f.checks)), [[active.id], [active.id]]);
});

test('bulk sync does not advance its checkpoint when search indexing fails', async () => {
  const f = await fixture({ indexFails: true });
  await assert.rejects(f.run(), /index unavailable/);
  assert.equal(f.job.productsProcessed, 0);
  assert.equal(f.job.status, 'IN_PROGRESS');
  assert.equal(f.checks.length, 0);
});
