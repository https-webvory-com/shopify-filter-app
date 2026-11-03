import { Readable } from 'node:stream';
import readline from 'node:readline';
import { catalogDrift } from '../utils/catalogDrift.js';

const BULK_QUERY = `query CatalogIdentityAudit {
  products { edges { node { id status publishedAt } } }
}`;

async function graphql(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const body = await response.json();
  if (response.ok === false || body.errors?.length || !body.data) throw Error('Shopify bulk catalog query failed');
  return body.data;
}

export async function startBulkCatalogAudit(admin) {
  const result = await graphql(admin, `mutation StartCatalogIdentityAudit($query: String!) {
    bulkOperationRunQuery(query: $query, groupObjects: false) {
      bulkOperation { id status }
      userErrors { message }
    }
  }`, { query: BULK_QUERY });
  const operation = result.bulkOperationRunQuery;
  if (operation?.userErrors?.length || !/^gid:\/\/shopify\/BulkOperation\/\d+$/.test(operation?.bulkOperation?.id || '')) {
    throw Error('Shopify rejected the bulk catalog audit');
  }
  return operation.bulkOperation.id;
}

export async function readBulkCatalogAudit(admin, operationId, fetcher = fetch) {
  if (!/^gid:\/\/shopify\/BulkOperation\/\d+$/.test(operationId || '')) throw Error('Invalid bulk operation ID');
  const result = await graphql(admin, `query CatalogIdentityAuditStatus($id: ID!) {
    bulkOperation(id: $id) { id status url errorCode rootObjectCount }
  }`, { id: operationId });
  const operation = result.bulkOperation;
  if (operation?.id !== operationId) throw Error('Bulk catalog audit is unavailable');
  if (operation.status === 'CREATED' || operation.status === 'RUNNING') return { status: 'pending' };
  if (operation.status !== 'COMPLETED') throw Error(`Bulk catalog audit ${operation.status || 'failed'}`);
  if (!operation.url) {
    if (Number(operation.rootObjectCount) !== 0) throw Error('Completed bulk catalog audit has no data');
    return { status: 'complete', products: [] };
  }
  const url = new URL(operation.url);
  if (url.protocol !== 'https:') throw Error('Bulk catalog URL must use HTTPS');
  const response = await fetcher(url, { signal: AbortSignal.timeout(600000) });
  if (!response.ok || !response.body) throw Error('Could not download Shopify bulk catalog');
  const products = [];
  const lines = readline.createInterface({ input: Readable.fromWeb(response.body), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.length > 1048576) throw Error('Bulk catalog row is too large');
    if (!line.trim()) continue;
    const product = JSON.parse(line);
    if (!/^gid:\/\/shopify\/Product\/\d+$/.test(product?.id || '') ||
        !['ACTIVE', 'DRAFT', 'ARCHIVED', 'UNLISTED'].includes(product.status)) throw Error('Invalid bulk catalog row');
    products.push({ id: product.id, status: product.status, publishedAt: product.publishedAt || null });
  }
  if (Number.isSafeInteger(Number(operation.rootObjectCount)) && products.length !== Number(operation.rootObjectCount)) {
    throw Error('Incomplete Shopify bulk catalog download');
  }
  return { status: 'complete', products };
}

export async function auditCatalogDrift({ admin, prisma, shop, operationId, fetcher, bulkProducts }) {
  const bulk = bulkProducts ? { status: 'complete', products: bulkProducts } : await readBulkCatalogAudit(admin, operationId, fetcher);
  if (bulk.status !== 'complete') return bulk;
  const rows = await prisma.product.findMany({ where: { shop }, select: { id: true, status: true } });
  const indexed = rows.map(row => ({ id: row.id, status: String(row.status).toUpperCase() }));
  return { status: 'complete', ...catalogDrift(bulk.products, indexed) };
}

export async function auditSearchIndexDrift({ admin, index, shop, operationId, fetcher, bulkProducts }) {
  const bulk = bulkProducts ? { status: 'complete', products: bulkProducts } : await readBulkCatalogAudit(admin, operationId, fetcher);
  if (bulk.status !== 'complete') return bulk;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '')) throw Error('Invalid shop');
  const indexed = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const page = await index.getDocuments({
      filter: `shop = ${JSON.stringify(shop)}`,
      offset, limit, fields: ['id', 'status'],
    });
    if (!Array.isArray(page.results)) throw Error('Incomplete search index page');
    for (const hit of page.results) indexed.push({
      id: String(hit.id || '').startsWith('gid://') ? hit.id : `gid://shopify/Product/${hit.id}`,
      status: String(hit.status || '').toUpperCase(),
    });
    if (page.results.length < limit) {
      if (Number.isSafeInteger(page.total) && indexed.length !== page.total) throw Error('Incomplete search index scan');
      break;
    }
  }
  return { status: 'complete', ...catalogDrift(bulk.products, indexed) };
}
