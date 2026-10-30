import test from 'node:test';
import assert from 'node:assert/strict';
import { BULK_PRODUCT_QUERY, startBulkProductIndex, bulkProductIndexStatus, streamBulkProductIndex } from '../../app/services/shopifyBulkIndex.server.js';

const id = 'gid://shopify/BulkOperation/41';
const one = { id: 'gid://shopify/Product/1', title: 'Blue dress', handle: 'blue-dress', status: 'ACTIVE', publishedAt: '2026-10-01' };
const two = { id: 'gid://shopify/Product/2', title: 'Red dress', handle: 'red-dress', status: 'DRAFT', publishedAt: null };
const rows = [one,
  { __parentId: one.id, id: 'gid://shopify/ProductVariant/11', price: '12', inventoryItem: { id: 'gid://shopify/InventoryItem/11' } },
  { __parentId: one.id, id: 'gid://shopify/Collection/21', title: 'Dresses', handle: 'dresses' },
  { __parentId: one.id, id: 'gid://shopify/Metafield/31', namespace: 'custom', key: 'fabric', value: 'Silk', type: 'single_line_text_field' },
  { __parentId: one.id, url: 'https://cdn.shopify.com/image.jpg' }, two];
const fetcher = async () => new Response(rows.map(row => JSON.stringify(row)).join('\n'));

test('bulk index query covers complete child connections and uses grouped JSONL', async () => {
  assert.equal((BULK_PRODUCT_QUERY.match(/edges\s*\{/g) || []).length, 5);
  let variables;
  const admin = { graphql: async (_query, input) => {
    variables = input.variables;
    return { json: async () => ({ data: { bulkOperationRunQuery: { bulkOperation: { id }, userErrors: [] } } }) };
  } };
  assert.equal(await startBulkProductIndex(admin), id);
  assert.equal(variables.query, BULK_PRODUCT_QUERY);
  const status = await bulkProductIndexStatus({ graphql: async () => ({ json: async () => ({ data: {
    bulkOperation: { id, status: 'COMPLETED', url: 'https://storage.googleapis.com/catalog', rootObjectCount: '2', objectCount: '6' },
  } }) }) }, id);
  assert.deepEqual(status, { status: 'complete', url: 'https://storage.googleapis.com/catalog', count: 2, objectCount: 6 });
});

test('bulk JSONL streams one complete product at a time and resumes after a verified root', async () => {
  const received = [];
  const total = await streamBulkProductIndex({ url: 'https://storage.googleapis.com/catalog', count: 2, objectCount: 6,
    skip: 1, fetcher, onProduct: async (product, root) => received.push({ product, root }) });
  assert.equal(total, 2);
  assert.equal(received.length, 1);
  assert.equal(received[0].root, 2);
  assert.equal(received[0].product.id, two.id);
  const all = [];
  await streamBulkProductIndex({ url: 'https://storage.googleapis.com/catalog', count: 2, objectCount: 6,
    fetcher, onProduct: async product => all.push(product) });
  assert.equal(all[0].variants.nodes.length, 1);
  assert.equal(all[0].collections.nodes.length, 1);
  assert.equal(all[0].metafields.nodes.length, 1);
  assert.equal(all[0].images.nodes.length, 1);
  assert.equal(all[0].variants.pageInfo.hasNextPage, false);
});

test('bulk JSONL rejects partial files and foreign child groups', async () => {
  await assert.rejects(streamBulkProductIndex({ url: 'https://storage.googleapis.com/catalog', count: 3,
    fetcher, onProduct: async () => {} }), /Incomplete bulk product export/);
  const broken = async () => new Response([JSON.stringify(one), JSON.stringify({ __parentId: two.id, url: 'https://cdn.shopify.com/image.jpg' })].join('\n'));
  await assert.rejects(streamBulkProductIndex({ url: 'https://storage.googleapis.com/catalog', count: 1,
    fetcher: broken, onProduct: async () => {} }), /not grouped/);
});
