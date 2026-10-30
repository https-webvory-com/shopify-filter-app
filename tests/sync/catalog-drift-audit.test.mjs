import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { isStorefrontProduct } from '../../app/utils/storefrontProduct.js';

const shop = 'fixture.myshopify.com';
const gid = n => `gid://shopify/Product/${n}`;

async function fixture() {
  const queued = [], writes = [], repaired = [], audits = [];
  const prisma = { product: { findMany: async () => [{ shop }] }, session: { findFirst: async () => ({ id: 'offline' }) },
    syncJob: { findFirst: async () => null } };
  const redis = { get: async () => null, set: async (key, value) => { writes.push([key, value]); } };
  const queue = { getJob: async () => null, add: async (name, data) => queued.push([name, data]) };
  const catalog = { readBulkCatalogAudit: async () => ({ status: 'complete', products: [
    { id: gid(1), status: 'ACTIVE', publishedAt: '2026-10-01' },
    { id: gid(2), status: 'DRAFT', publishedAt: null },
    { id: gid(3), status: 'ACTIVE', publishedAt: null },
  ] }), auditCatalogDrift: async ({ bulkProducts }) => { audits.push(bulkProducts); return { shopifyCount: 1, indexedCount: 0, missing: [gid(1)], extra: [], statusMismatch: [] }; },
    auditSearchIndexDrift: async ({ bulkProducts }) => { audits.push(bulkProducts); return { shopifyCount: 1, indexedCount: 1, missing: [], extra: [], statusMismatch: [] }; } };
  const source = (await fs.readFile('app/services/catalogDriftAudit.server.js', 'utf8'))
    .replace("await import('../shopify.server.js')", 'auth')
    .replaceAll("await import('./sync.server.js')", 'sync')
    .replace("await import('./shopCache.server.js')", 'cache');
  const mocks = { 'node:crypto': { createHash }, '../db.server.js': { __esModule: true, default: prisma },
    './redis.server.js': { __esModule: true, default: redis },
    './meiliClient.server.js': { __esModule: true, default: { index: () => ({}) } },
    './productSyncQueue.server.js': { productSyncQueue: queue },
    '../utils/syncError.js': { productSyncJobWhere: value => ({ shop: value }) },
    './shopifyBulkCatalog.server.js': catalog,
    '../utils/storefrontProduct.js': { isStorefrontProduct } };
  const ctx = { module: { exports: {} }, exports: {}, require: name => mocks[name],
    auth: { unauthenticated: { admin: async () => ({ admin: {} }) } },
    sync: { syncSingleProduct: async (_shop, _admin, id) => repaired.push(id) },
    cache: { invalidateShop: async () => {} }, console: { log() {} }, Date };
  vm.runInNewContext((await transform(source, { format: 'cjs' })).code, ctx);
  return { service: ctx.module.exports, queued, writes, repaired, audits };
}

test('daily scheduler queues a store with an offline session', async () => {
  const f = await fixture();
  await f.service.scheduleCatalogDriftAudits();
  assert.deepEqual(f.queued.map(([name, data]) => [name, data.shop]), [['CATALOG_DRIFT_AUDIT', shop]]);
});

test('catalog drift compares only Shopify storefront eligible products and repairs differences', async () => {
  const f = await fixture();
  const result = await f.service.processCatalogDriftAudit({ data: { shop, operationId: 'gid://shopify/BulkOperation/1' } });
  assert.equal(result.repaired, 1);
  assert.deepEqual(f.repaired, [gid(1)]);
  assert.ok(f.audits.every(products => products.length === 1 && products[0].id === gid(1)));
  assert.ok(f.writes.some(([key]) => key.startsWith('catalogDriftLast:')));
});
