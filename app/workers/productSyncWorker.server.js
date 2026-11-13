import { Worker, DelayedError } from "bullmq";
import { redisOptions } from "../services/queue.server.js";
import prisma from "../db.server.js";
import { syncErrorMessage } from "../utils/syncError.js";

export async function processProductSyncJob(job, token) {
  if (job.name === 'SIZE_MAPPING_REBUILD') {
    const { invalidateSizeMappings } = await import('../services/sync.server.js');
    invalidateSizeMappings(job.data.shop);
    const { rebuildSizeMappingPage } = await import('../services/sizeMapping.server.js');
    const result = await rebuildSizeMappingPage(job);
    if (!result.complete) {
      await job.moveToDelayed(Date.now() + 100, token);
      throw new DelayedError();
    }
    return result;
  }
  if (job.name === 'CATALOG_DRIFT_AUDIT') {
    const { processCatalogDriftAudit } = await import('../services/catalogDriftAudit.server.js');
    const result = await processCatalogDriftAudit(job);
    if (result?.needsContinuation) {
      await job.moveToDelayed(Date.now() + (result.retryAfterMs || 10000), token);
      throw new DelayedError();
    }
    return result;
  }
  const { shop, syncJobId } = job.data;
  const saved = await prisma.syncJob.findUnique({ where: { id: syncJobId } });
  if (!saved || saved.shop !== shop || (saved.status === "COMPLETED" && saved.completedAt)) return;
  await prisma.syncJob.update({ where: { id: syncJobId }, data: { status: "IN_PROGRESS", kind: saved.kind === 'BULK_PRODUCTS' ? 'BULK_PRODUCTS' : 'PRODUCTS', completedAt: null } });
  try {
    // Offline authentication survives closure of the admin page and server restarts.
    const { unauthenticated } = await import("../shopify.server.js");
    const { runProductSync, runBulkProductSync } = await import("../services/sync.server.js");
    const { admin } = await unauthenticated.admin(shop);
    const result = saved.kind === 'BULK_PRODUCTS'
      ? await runBulkProductSync(syncJobId, shop, admin)
      : await runProductSync(syncJobId, shop, admin, { markFailure: false, maxBatches: 5 });
    if (result?.needsContinuation) {
      // Release the worker between committed batches so another store can sync.
      await job.moveToDelayed(Date.now() + (result.retryAfterMs || 100), token);
      throw new DelayedError();
    }
  } catch (error) {
    if (error instanceof DelayedError) throw error;
    const retrying = job.attemptsMade + 1 < (job.opts.attempts || 1);
    const restartScan=retrying&&error.restartProductScan===true&&(job.data.scanRestarts||0)<2;
    if(restartScan)await job.updateData({...job.data,scanRestarts:(job.data.scanRestarts||0)+1});
    await prisma.syncJob.update({ where: { id: syncJobId }, data: {
      status: retrying ? "IN_PROGRESS" : "FAILED", lastError: syncErrorMessage(error), retryCount: job.attemptsMade + 1,
      ...(restartScan?{cursor:null,productsProcessed:0,...(Number.isSafeInteger(error.expectedTotal)?{totalProducts:error.expectedTotal}:{})}:{}),
    } });
    throw error;
  }
}

export async function recordProductSyncQueueFailure(job,error) {
  if(!job?.data?.syncJobId||!job.data.shop||await job.getState()!=='failed')return;
  await prisma.syncJob.updateMany({where:{id:job.data.syncJobId,shop:job.data.shop,status:'IN_PROGRESS'},
    data:{status:'FAILED',lastError:syncErrorMessage(error)}});
}

export function initProductSyncWorker() {
  if (!global.__productSyncWorker) {
    global.__productSyncWorker = new Worker("productSyncQueue", processProductSyncJob, {
      connection: { ...redisOptions, maxRetriesPerRequest: null },
      concurrency: 2,
      lockDuration: 180000,
      lockRenewTime: 15000,
      maxStalledCount: 5,
    });
    global.__productSyncWorker.on("error", error => console.error("CFP Product sync worker:", error.message));
    global.__productSyncWorker.on("failed", (job,error) => {
      console.error("CFP Product sync retry:", job?.id, error.message);
      void recordProductSyncQueueFailure(job,error).catch(failure=>console.error('CFP Product sync failure reporting:',failure.name));
    });
  }
  return global.__productSyncWorker;
}
