import { createHash } from 'node:crypto';
import prisma from '../db.server.js';
import redis from './redis.server.js';
import meiliClient from './meiliClient.server.js';
import { productSyncQueue } from './productSyncQueue.server.js';
import { productSyncJobWhere } from '../utils/syncError.js';
import { startBulkCatalogAudit, readBulkCatalogAudit, auditCatalogDrift, auditSearchIndexDrift } from './shopifyBulkCatalog.server.js';
import { isStorefrontProduct } from '../utils/storefrontProduct.js';

const validShop = shop => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop || '');
const lastKey = shop => `catalogDriftLast:${shop}`;
const statusKey = shop => `catalogDriftStatus:${shop}`;
const jobId = shop => 'catalog-drift-' + createHash('sha256').update(shop).digest('hex');

export async function scheduleCatalogDriftAudits() {
  const shops = await prisma.product.findMany({ distinct: ['shop'], select: { shop: true } });
  for (const { shop } of shops) {
    if (!validShop(shop)) continue;
    if (!await prisma.session.findFirst({ where: { shop, isOnline: false }, select: { id: true } })) continue;
    if (await prisma.syncJob.findFirst({ where: { ...productSyncJobWhere(shop), status: 'IN_PROGRESS' }, select: { id: true } })) continue;
    const last = Number(await redis.get(lastKey(shop)) || 0);
    if (Date.now() - last < 86400000) continue;
    const existing = await productSyncQueue.getJob(jobId(shop));
    if (existing) {
      const state = await existing.getState();
      if (['waiting', 'active', 'prioritized', 'delayed'].includes(state)) continue;
      if (state === 'failed') { await existing.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true }); continue; }
      await existing.remove();
    }
    await productSyncQueue.add('CATALOG_DRIFT_AUDIT', { shop }, { jobId: jobId(shop), attempts: 5,
      backoff: { type: 'exponential', delay: 15000 }, removeOnComplete: true });
  }
}

const summary = drift => ({ shopifyCount: drift.shopifyCount, indexedCount: drift.indexedCount,
  missing: drift.missing.length, extra: drift.extra.length, statusMismatch: drift.statusMismatch.length });

export async function processCatalogDriftAudit(job) {
  const { shop } = job.data;
  if (!validShop(shop)) throw Error('Invalid catalog audit shop');
  const { unauthenticated } = await import('../shopify.server.js');
  const { admin } = await unauthenticated.admin(shop);
  if (!admin) throw Error('Shopify Admin session unavailable');
  let operationId = job.data.operationId;
  if (!operationId) {
    operationId = await startBulkCatalogAudit(admin);
    await job.updateData({ shop, operationId });
    return { needsContinuation: true, retryAfterMs: 10000 };
  }
  const operation = await readBulkCatalogAudit(admin, operationId);
  if (operation.status === 'pending') return { needsContinuation: true, retryAfterMs: 10000 };
  const eligible = operation.products.filter(isStorefrontProduct);
  const [database, search] = await Promise.all([
    auditCatalogDrift({ prisma, shop, bulkProducts: eligible }),
    auditSearchIndexDrift({ index: meiliClient.index('products'), shop, bulkProducts: eligible }),
  ]);
  const affected = [...new Set([...database.missing, ...database.extra, ...database.statusMismatch.map(row => row.id),
    ...search.missing, ...search.extra, ...search.statusMismatch.map(row => row.id)])];
  let repairQueued = false;
  if (affected.length > 250) {
    const { startBulkProductSync } = await import('./sync.server.js');
    await startBulkProductSync(shop);
    repairQueued = true;
  } else if (affected.length) {
    const { syncSingleProduct } = await import('./sync.server.js');
    for (const id of affected) await syncSingleProduct(shop, admin, id, { retrySearchErrors: true });
    const { invalidateShop } = await import('./shopCache.server.js');
    await invalidateShop(shop, { kind: 'catalog' });
  }
  const result = { shop, auditedAt: new Date().toISOString(), operationId,
    database: summary(database), search: summary(search), repaired: repairQueued ? 0 : affected.length, repairQueued };
  await redis.set(statusKey(shop), JSON.stringify(result));
  await redis.set(lastKey(shop), String(Date.now()));
  console.log('CFP catalog drift audit:', JSON.stringify(result));
  return result;
}
