import test from 'node:test';
import assert from 'node:assert/strict';
import { BULK_PRODUCT_QUERY, bulkProductQuery, startBulkProductIndex, bulkProductIndexStatus, streamBulkProductIndex } from '../../app/services/shopifyBulkIndex.server.js';
import { readBulkCatalogAudit } from '../../app/services/shopifyBulkCatalog.server.js';
import { isStorefrontProduct } from '../../app/utils/storefrontProduct.js';

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

test('slow product writes do not abort a healthy bulk stream, but stalled reads time out', async () => {
  let aborted = false;
  await streamBulkProductIndex({ url: 'https://storage.googleapis.com/catalog', count: 2, objectCount: 6,
    readIdleTimeoutMs: 10, fetcher: async (_url, { signal }) => {
      signal.addEventListener('abort', () => { aborted = true; });
      return fetcher();
    }, onProduct: async () => new Promise(resolve => setTimeout(resolve, 30)) });
  assert.equal(aborted, false);
  const stalled = async (_url, { signal }) => new Response(new ReadableStream({ start(controller) {
    signal.addEventListener('abort', () => controller.error(Error('aborted')));
  } }));
  await assert.rejects(streamBulkProductIndex({ url: 'https://storage.googleapis.com/catalog', count: 1,
    readIdleTimeoutMs: 10, fetcher: stalled, onProduct: async () => {} }), /Bulk product export stalled/);
});

test('both bulk readers accept unlisted Shopify products without making them storefront eligible', async () => {
  const unlisted={id:'gid://shopify/Product/3',title:'Private product',handle:'private-product',status:'UNLISTED',publishedAt:'2026-10-01'};
  const fetcher=async()=>new Response(JSON.stringify(unlisted));
  const received=[];
  await streamBulkProductIndex({url:'https://storage.googleapis.com/catalog',count:1,objectCount:1,fetcher,
    onProduct:async product=>received.push(product)});
  assert.equal(received[0].status,'UNLISTED');
  assert.equal(isStorefrontProduct(received[0]),false);
  const admin={graphql:async()=>({json:async()=>({data:{bulkOperation:{id,status:'COMPLETED',
    url:'https://storage.googleapis.com/catalog',rootObjectCount:'1'}}})})};
  const audit=await readBulkCatalogAudit(admin,id,fetcher);
  assert.equal(audit.products[0].status,'UNLISTED');
  assert.equal(audit.products.filter(isStorefrontProduct).length,0);
});

test('bulk price query requests each observed country without adding a child connection', async () => {
  const query=bulkProductQuery(['IN','US','IN']);
  assert.equal((query.match(/edges\s*\{/g)||[]).length,5);
  assert.equal((query.match(/cfpMarket_IN:/g)||[]).length,1);
  assert.equal((query.match(/cfpMarket_US:/g)||[]).length,1);
  assert.match(query,/cfpMarket_IN: contextualPricing\(context: \{country: IN\}\)/);
  let submitted;
  await startBulkProductIndex({graphql:async(_query,{variables})=>{
    submitted=variables.query;
    return{json:async()=>({data:{bulkOperationRunQuery:{bulkOperation:{id},userErrors:[]}}})};
  }},{countries:['IN']});
  assert.match(submitted,/cfpMarket_IN:/);
});
