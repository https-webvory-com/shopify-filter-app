import { Queue } from "bullmq";

const REDIS_HOST = "184.72.37.227";
const REDIS_PORT = 6379;

export const redisOptions = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  family: 4,
  connectTimeout: 10000,
};

let webhookQueue;

if (!global.__webhookQueue) {
  global.__webhookQueue = new Queue("webhookQueue", {
    connection: redisOptions,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
  global.__webhookQueue.on("error", (error) => {
    console.error("CFP Queue: Redis connection error:", error);
  });
}
webhookQueue = global.__webhookQueue;

export { webhookQueue };

/**
 * Enqueue a webhook job into BullMQ queue.
 */
export async function enqueueWebhookJob(topic, data) {
  try {
    const job = await webhookQueue.add(topic, data);
    console.log(`CFP Queue: Enqueued webhook job #${job.id} for topic "${topic}"`);
    return job;
  } catch (error) {
    console.error(`CFP Queue Error: Failed to enqueue webhook job for ${topic}:`, error);
    throw error;
  }
}
