import { Queue } from "bullmq";
import { redisOptions } from "./queue.server.js";

export const productSyncQueue = global.__productSyncQueue ||= new Queue("productSyncQueue", {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 10,
    backoff: { type: "exponential", delay: 15000 },
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 1000 },
  },
});
productSyncQueue.on("error", error => console.error("CFP Product sync queue:", error.message));

export async function enqueueProductSync(jobId, shop) {
  const existing = await productSyncQueue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") {
      await existing.updateData({...existing.data,scanRestarts:0});
      await existing.retry("failed", { resetAttemptsMade: true, resetAttemptsStarted: true }); return existing;
    }
    if (state !== "completed") return existing;
    await existing.remove();
  }
  return productSyncQueue.add("SYNC_PRODUCTS", { shop, syncJobId: jobId }, { jobId });
}
