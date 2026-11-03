import { Queue } from "bullmq";
import {redisConnectionOptions} from './redisConnection.server.js';

export const redisOptions = redisConnectionOptions;

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

// Ranking scans have their own lane so they cannot occupy webhook/sync slots.
if (!global.__collectionRankingQueue) {
  global.__collectionRankingQueue = new Queue('collectionRankingQueueV2', {
    connection: redisOptions,
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true, removeOnFail: { count: 50, age: 3600 } },
  });
  global.__collectionRankingQueue.on('error', error => console.error('CFP Ranking Queue:', error.message));
}
export const collectionRankingQueue = global.__collectionRankingQueue;

// Shopify order snapshots unblock storefront pages. Never put them behind
// catalog webhooks or full ranking scans, and keep retries durable.
if (!global.__collectionOrderQueue) {
  global.__collectionOrderQueue = new Queue('collectionOrderQueueV1', {
    connection: redisOptions,
    defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 }, removeOnFail: { count: 1000 } },
  });
  global.__collectionOrderQueue.on('error', error => console.error('CFP Collection Order Queue:', error.message));
}
export const collectionOrderQueue = global.__collectionOrderQueue;

// Membership audits never occupy storefront ranking or webhook lanes.
export const collectionMembershipQueue = global.__collectionMembershipQueue ||= new Queue('collectionMembershipQueueV1', {
  connection: redisOptions,
  defaultJobOptions: {attempts:5,backoff:{type:'exponential',delay:10000},removeOnComplete:true,removeOnFail:{count:1000}},
});
collectionMembershipQueue.on('error',error=>console.error('CFP Membership Queue:',error.message));

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
