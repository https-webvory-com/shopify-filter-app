import { Readable } from 'node:stream';
import readline from 'node:readline';
import { contextualPricingFields } from '../utils/marketPricingIndex.js';

const PRODUCT = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const COLLECTION = /^gid:\/\/shopify\/Collection\/\d+$/;
const METAFIELD = /^gid:\/\/shopify\/Metafield\/\d+$/;
const OPERATION = /^gid:\/\/shopify\/BulkOperation\/\d+$/;

// Four child connections plus products are within Shopify's five-connection,
// two-level Bulk Operations limit. Grouping permits one-product-at-a-time
// ingestion without retaining a store's variants in worker memory.
const BULK_PRODUCT_QUERY_TEMPLATE = `query BulkProductIndex {
  products {
    edges { node {
      id title handle vendor productType tags totalInventory status
      onlineStoreUrl publishedAt options { name values }
      ratingMetafield: metafield(namespace: "reviews", key: "rating") { id namespace key value type }
      plusSizeMetafield: metafield(namespace: "custom", key: "plus_size_collection_image") { id namespace key value type reference { ... on MediaImage { image { url } } ... on GenericFile { url } } }
      motbMetafield: metafield(namespace: "custom", key: "mother_of_the_bride_collection_image") { id namespace key value type reference { ... on MediaImage { image { url } } ... on GenericFile { url } } }
      weddingMetafield: metafield(namespace: "custom", key: "wedding_collection_image") { id namespace key value type reference { ... on MediaImage { image { url } } ... on GenericFile { url } } }
      images { edges { node { url } } }
      collections { edges { node { id title handle } } }
      variants { edges { node { id sku price compareAtPrice inventoryQuantity availableForSale image { url } selectedOptions { name value } inventoryItem { id measurement { weight { value unit } } } __CFP_MARKET_PRICING__ } } }
      metafields { edges { node { id namespace key value type reference { ... on MediaImage { image { url } } ... on GenericFile { url } } } } }
    } }
  }
}`;
export const bulkProductQuery = countries => BULK_PRODUCT_QUERY_TEMPLATE.replace('__CFP_MARKET_PRICING__', contextualPricingFields(countries));
export const BULK_PRODUCT_QUERY = bulkProductQuery([]);

async function graphql(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const body = await response.json();
  if (response.ok === false || body.errors?.length || !body.data) throw Error('Shopify bulk index request failed');
  return body.data;
}

export async function startBulkProductIndex(admin, { countries = [] } = {}) {
  const data = await graphql(admin, `mutation StartBulkProductIndex($query: String!) {
    bulkOperationRunQuery(query: $query, groupObjects: true) {
      bulkOperation { id status }
      userErrors { message }
    }
  }`, { query: bulkProductQuery(countries) });
  const result = data.bulkOperationRunQuery;
  if (result?.userErrors?.length || !OPERATION.test(result?.bulkOperation?.id || '')) throw Error('Shopify rejected bulk product indexing');
  return result.bulkOperation.id;
}

export async function bulkProductIndexStatus(admin, id) {
  if (!OPERATION.test(id || '')) throw Error('Invalid bulk operation ID');
  const data = await graphql(admin, `query BulkProductIndexStatus($id: ID!) {
    bulkOperation(id: $id) { id status url errorCode rootObjectCount objectCount }
  }`, { id });
  if (data.bulkOperation?.id !== id) throw Error('Bulk product operation is unavailable');
  const operation = data.bulkOperation;
  if (['CREATED', 'RUNNING'].includes(operation.status)) return { status: 'pending' };
  if (operation.status !== 'COMPLETED') throw Error(`Bulk product operation ${operation.status || 'failed'}`);
  if (!operation.url) {
    if (Number(operation.rootObjectCount) !== 0) throw Error('Completed bulk product operation has no data');
    return { status: 'complete', url: null, count: 0, objectCount: 0 };
  }
  if (new URL(operation.url).protocol !== 'https:') throw Error('Bulk product URL must use HTTPS');
  return { status: 'complete', url: operation.url, count: Number(operation.rootObjectCount), objectCount: Number(operation.objectCount) };
}

function beginProduct(row) {
  if (!PRODUCT.test(row.id || '') || !['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED'].includes(row.status) ||
      typeof row.title !== 'string' || typeof row.handle !== 'string') throw Error('Invalid bulk product');
  return { ...row, images: { nodes: [] }, collections: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
    variants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, metafields: { nodes: [] } };
}

export async function streamBulkProductIndex({ url, count, objectCount, onProduct, onRoot, skip = 0, fetcher = fetch }) {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(skip) || skip < 0 || skip > count) throw Error('Invalid bulk index count');
  if (!url) { if (count !== 0) throw Error('Missing bulk index data'); return 0; }
  const response = await fetcher(url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || !response.body) throw Error('Could not download bulk product index');
  const lines = readline.createInterface({ input: Readable.fromWeb(response.body), crlfDelay: Infinity });
  let current = null, roots = 0, objects = 0;
  const seen = new Set();
  const finish = async () => { if (current && roots > skip) await onProduct(current, roots); };
  for await (const line of lines) {
    if (line.length > 2097152) throw Error('Bulk product row is too large');
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    objects++;
    if (!row.__parentId) {
      await finish();
      if (seen.has(row.id)) throw Error('Duplicate bulk product');
      current = beginProduct(row); seen.add(row.id); roots++;
      if (onRoot) await onRoot(current, roots);
      continue;
    }
    if (!current || row.__parentId !== current.id) throw Error('Bulk product children are not grouped by parent');
    delete row.__parentId;
    if (VARIANT.test(row.id || '')) current.variants.nodes.push(row);
    else if (COLLECTION.test(row.id || '')) current.collections.nodes.push(row);
    else if (METAFIELD.test(row.id || '')) current.metafields.nodes.push(row);
    else if (typeof row.url === 'string' && !row.id) current.images.nodes.push(row);
    else throw Error('Unknown bulk product child');
  }
  if (roots !== count || (Number.isSafeInteger(objectCount) && objectCount >= 0 && objects !== objectCount)) throw Error('Incomplete bulk product export');
  await finish();
  return roots;
}
