import { Worker, DelayedError } from "bullmq";
import { redisOptions } from "../services/queue.server.js";
import prisma from "../db.server.js";
import { syncErrorMessage } from "../utils/syncError.js";

export async function processProductSyncJob(job, token) {
  const { shop, syncJobId } = job.data;
  const saved = await prisma.syncJob.findUnique({ where: { id: syncJobId } });
  if (!saved || saved.shop !== shop || (saved.status === "COMPLETED" && saved.completedAt)) return;
  await prisma.syncJob.update({ where: { id: syncJobId }, data: { status: "IN_PROGRESS", kind: "PRODUCTS", completedAt: null } });
  try {
    // Offline authentication survives closure of the admin page and server restarts.
    const { unauthenticated } = await import("../shopify.server.js");
    const { runProductSync } = await import("../services/sync.server.js");
    const { admin } = await unauthenticated.admin(shop);
    const result = await runProductSync(syncJobId, shop, admin, { markFailure: false, maxBatches: 5 });
    if (result?.needsContinuation) {
      // Release the worker between committed batches so another store can sync.
      await job.moveToDelayed(Date.now() + 100, token);
      throw new DelayedError();
    }
  } catch (error) {
    if (error instanceof DelayedError) throw error;
    const retrying = job.attemptsMade + 1 < (job.opts.attempts || 1);
    await prisma.syncJob.update({ where: { id: syncJobId }, data: { status: retrying ? "IN_PROGRESS" : "FAILED", lastError: syncErrorMessage(error), retryCount: job.attemptsMade + 1 } });
    throw error;
  }
}

export function initProductSyncWorker() {
  if (!global.__productSyncWorker) {
    global.__productSyncWorker = new Worker("productSyncQueue", processProductSyncJob, {
      connection: { ...redisOptions, maxRetriesPerRequest: null },
      concurrency: 1,
      lockDuration: 60000,
      maxStalledCount: 5,
    });
    global.__productSyncWorker.on("error", error => console.error("CFP Product sync worker:", error.message));
    global.__productSyncWorker.on("failed", (job,error) => console.error("CFP Product sync retry:", job?.id, error.message));
  }
  return global.__productSyncWorker;
}
