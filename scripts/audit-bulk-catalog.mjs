// Run in the deployed worker environment with an authorized offline session.
// The start step queues a read-only Shopify bulk export. Check later with the
// returned operation ID; no product, rule, or index records are changed.
import prisma from '../app/db.server.js';
import meiliClient from '../app/services/meiliClient.server.js';
import { unauthenticated } from '../app/shopify.server.js';
import { startBulkCatalogAudit, readBulkCatalogAudit, auditCatalogDrift, auditSearchIndexDrift } from '../app/services/shopifyBulkCatalog.server.js';

const [mode, shop, operationId] = process.argv.slice(2);
if (!['start', 'check'].includes(mode) || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '') ||
    (mode === 'check' && !/^gid:\/\/shopify\/BulkOperation\/\d+$/.test(operationId || ''))) {
  throw Error('Usage: node scripts/audit-bulk-catalog.mjs start|check SHOP [BULK_OPERATION_ID]');
}
const { admin } = await unauthenticated.admin(shop);
if (!admin) throw Error('Authorized Shopify Admin session unavailable');
if (mode === 'start') {
  const id = await startBulkCatalogAudit(admin);
  process.stdout.write(JSON.stringify({ status: 'started', shop, operationId: id }) + '\n');
} else {
  const bulk = await readBulkCatalogAudit(admin, operationId);
  if (bulk.status !== 'complete') {
    process.stdout.write(JSON.stringify({ status: bulk.status, shop, operationId }) + '\n');
    process.exit(0);
  }
  const [database, search] = await Promise.all([
    auditCatalogDrift({ prisma, shop, bulkProducts: bulk.products }),
    auditSearchIndexDrift({ index: meiliClient.index('products'), shop, bulkProducts: bulk.products }),
  ]);
  const summary = value => value.status !== 'complete' ? { status: value.status } : {
    status: value.status, shopifyCount: value.shopifyCount, indexedCount: value.indexedCount,
    missingCount: value.missing.length, extraCount: value.extra.length,
    statusMismatchCount: value.statusMismatch.length,
    missingSample: value.missing.slice(0, 20), extraSample: value.extra.slice(0, 20),
  };
  process.stdout.write(JSON.stringify({ shop, operationId, database: summary(database), search: summary(search) }) + '\n');
}
