// Fill only missing IN variant prices from an already completed Shopify bulk export.
// This does not start a bulk operation or sync products, collections, or other markets.
// Run in the deployed worker container with --shop and --source-job; --apply writes.
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { REDIS_URL } from '../app/services/redisConnection.server.js';
import meiliClient from '../app/services/meiliClient.server.js';
import { bulkProductIndexStatus, streamBulkProductIndex } from '../app/services/shopifyBulkIndex.server.js';
import { variantMarketPrices, productMarketPriceIndexFields } from '../app/utils/marketPricingIndex.js';
import { createShopCacheInvalidation } from '../app/utils/shopCacheInvalidation.js';

const arg = name => process.argv[process.argv.indexOf(name) + 1];
const shop = process.argv.includes('--shop') ? arg('--shop') : '';
const sourceJobId = process.argv.includes('--source-job') ? arg('--source-job') : '';
const apply = process.argv.includes('--apply');
if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !/^[0-9a-f-]{36}$/i.test(sourceJobId))
  throw Error('Explicit --shop and --source-job UUID are required');

const db = new PrismaClient();
const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
redis.on('error', () => {});
const index = meiliClient.index('products');
const counters = { roots: 0, variantsInExport: 0, pricedInExport: 0, variantsWritten: 0, indexedProducts: 0, missingDocuments: 0 };
let wrote = false;

async function updateIndexedPrices(productIds) {
  if (!productIds.length) return;
  const products = await db.product.findMany({ where: { shop, id: { in: productIds } },
    select: { id: true, status: true, variants: { select: { available: true, marketPrices: true } } } });
  const ready = products.flatMap(product => {
    if (String(product.status).toUpperCase() !== 'ACTIVE') return [];
    const fields = Object.fromEntries(Object.entries(productMarketPriceIndexFields(product.variants))
      .filter(([field]) => field.endsWith('_IN')));
    return fields.marketPriceMin_IN == null ? [] : [{ id: product.id.split('/').pop(), ...fields }];
  });
  if (!ready.length) return;
  // Meilisearch updateDocuments can create a new document. Check existing IDs
  // so a price-only patch cannot create an incomplete catalog document.
  const ids = ready.map(product => product.id);
  const response = await index.search('', { filter: [
    `shop = ${JSON.stringify(shop)}`,
    `id IN [${ids.map(JSON.stringify).join(',')}]`,
  ], hitsPerPage: ids.length, page: 1, attributesToRetrieve: ['id', 'shop'] });
  const existing = new Set(response.hits.map(hit => String(hit.id)));
  const patches = ready.filter(product => existing.has(product.id));
  counters.missingDocuments += ready.length - patches.length;
  if (!patches.length) return;
  const task = await index.updateDocuments(patches);
  const done = await meiliClient.tasks.waitForTask(task.taskUid, { timeout: 120000, interval: 500 });
  if (done.status !== 'succeeded') throw Error(`India price index update failed: ${done.error?.code || done.status}`);
  counters.indexedProducts += patches.length;
}

async function flush(batch) {
  if (!batch.length) return;
  const prices = [];
  for (const product of batch) {
    counters.roots++;
    for (const variant of product.variants.nodes) {
      counters.variantsInExport++;
      try {
        const market = variantMarketPrices(variant, ['IN']).IN;
        prices.push({ id: variant.id, productId: product.id, market });
        counters.pricedInExport++;
      } catch (error) {
        // A missing selling price cannot be used for sorting; leave it visibly
        // incomplete rather than substituting USD or a different market.
        if (error.message !== 'Incomplete contextual price for IN') throw error;
      }
    }
  }
  if (!apply) return;
  if (prices.length) {
    const updated = await db.$queryRaw`
      UPDATE "Variant" v
      SET "marketPrices" = jsonb_set(COALESCE(v."marketPrices", '{}'::jsonb), '{IN}', source.market, true)
      FROM jsonb_to_recordset(${JSON.stringify(prices)}::jsonb)
        AS source(id text, "productId" text, market jsonb), "Product" p
      WHERE v.id = source.id AND v."productId" = source."productId"
        AND p.id = v."productId" AND p.shop = ${shop}
        AND (v."marketPrices" -> 'IN' ->> 'price') IS NULL
      RETURNING v."productId" AS "productId"
    `;
    counters.variantsWritten += updated.length;
    if (updated.length) wrote = true;
  }
  // Also reconcile saved DB prices that a previous product sync did not project
  // into the serving index. This is a price-only patch for existing documents.
  await updateIndexedPrices(batch.map(product => product.id));
  if (counters.roots % 1000 < batch.length) console.log(JSON.stringify({ ...counters, apply }));
}

try {
  const sourceJob = await db.syncJob.findUnique({ where: { id: sourceJobId },
    select: { shop: true, kind: true, status: true, cursor: true } });
  if (sourceJob?.shop !== shop || sourceJob?.kind !== 'BULK_PRODUCTS' ||
      sourceJob.status !== 'FAILED' || !sourceJob.cursor)
    throw Error('Source must be a failed bulk product job for this shop with a completed export');
  const session = await db.session.findFirst({ where: { shop, isOnline: false }, select: { accessToken: true } });
  if (!session?.accessToken) throw Error('Offline Shopify session unavailable');
  const admin = { graphql: async (query, { variables }) => {
    const response = await fetch(`https://${shop}/admin/api/2026-07/graphql.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': session.accessToken },
      body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30000),
    });
    return response;
  } };
  const operation = await bulkProductIndexStatus(admin, sourceJob.cursor);
  if (operation.status !== 'complete' || !operation.url || !operation.count) throw Error('Completed source export is unavailable');
  console.log(JSON.stringify({ apply, shop, sourceJobId, exportProducts: operation.count, phase: 'start' }));
  const batch = [];
  await streamBulkProductIndex({ ...operation, onProduct: async product => {
    batch.push(product);
    if (batch.length >= 200) await flush(batch.splice(0));
  } });
  await flush(batch);
  console.log(JSON.stringify({ ...counters, apply, complete: true }));
} finally {
  try {
    // Do this even after a partial failure: a rerun is safe and shoppers must
    // not keep a stale price ranking after any successfully indexed batch.
    if (wrote) await createShopCacheInvalidation({ redis })(shop, { kind: 'configuration' });
  } finally { redis.disconnect(); await db.$disconnect(); }
}
