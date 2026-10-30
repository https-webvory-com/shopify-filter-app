import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogDrift } from '../../app/utils/catalogDrift.js';
import { startBulkCatalogAudit, auditCatalogDrift, auditSearchIndexDrift } from '../../app/services/shopifyBulkCatalog.server.js';

const gid = n => `gid://shopify/Product/${n}`;
test('catalog drift distinguishes missing, extra, and status mismatches', () => {
  assert.deepEqual(catalogDrift(
    [{ id: gid(1), status: 'ACTIVE' }, { id: gid(2), status: 'DRAFT' }],
    [{ id: gid(1), status: 'DRAFT' }, { id: gid(3), status: 'ACTIVE' }],
  ), {
    shopifyCount: 2, indexedCount: 2, missing: [gid(2)], extra: [gid(3)],
    statusMismatch: [{ id: gid(1), shopifyStatus: 'ACTIVE', indexedStatus: 'DRAFT' }],
  });
  assert.throws(() => catalogDrift([{ id: gid(1), status: 'ACTIVE' }, { id: gid(1), status: 'ACTIVE' }], []), /Duplicate/);
});

test('Shopify bulk audit streams a complete identity file and scopes the database comparison', async () => {
  const operationId = 'gid://shopify/BulkOperation/7';
  const calls = [];
  const admin = { graphql: async (_query, { variables }) => {
    calls.push(variables);
    if (variables.query) return { ok: true, json: async () => ({ data: { bulkOperationRunQuery: {
      bulkOperation: { id: operationId, status: 'CREATED' }, userErrors: [],
    } } }) };
    return { ok: true, json: async () => ({ data: { bulkOperation: {
      id: operationId, status: 'COMPLETED', url: 'https://storage.example.test/catalog.jsonl', rootObjectCount: '2',
    } } }) };
  } };
  assert.equal(await startBulkCatalogAudit(admin), operationId);
  const result = await auditCatalogDrift({
    admin, operationId, shop: 'one.myshopify.com',
    prisma: { product: { findMany: async ({ where, select }) => {
      assert.deepEqual(where, { shop: 'one.myshopify.com' });
      assert.deepEqual(select, { id: true, status: true });
      return [{ id: gid(1), status: 'active' }];
    } } },
    fetcher: async url => {
      assert.equal(url.hostname, 'storage.example.test');
      return new Response(`${JSON.stringify({ id: gid(1), status: 'ACTIVE' })}\n${JSON.stringify({ id: gid(2), status: 'DRAFT' })}\n`);
    },
  });
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.missing, [gid(2)]);
  assert.deepEqual(result.extra, []);
  const search = await auditSearchIndexDrift({
    shop: 'one.myshopify.com', bulkProducts: [{ id: gid(1), status: 'ACTIVE' }, { id: gid(2), status: 'DRAFT' }],
    index: { search: async (_query, options) => {
      assert.deepEqual(options.filter, ['shop = "one.myshopify.com"']);
      return { hits: [{ id: '1', status: 'ACTIVE' }], totalHits: 1 };
    } },
  });
  assert.deepEqual(search.missing, [gid(2)]);
});
