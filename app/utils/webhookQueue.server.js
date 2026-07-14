/**
 * In-memory Webhook Queue with concurrency control and deduplication.
 *
 * Why this exists:
 * - Shopify sends many concurrent webhooks (products_update, etc.)
 * - Each webhook needs DB connections
 * - Without a queue, 50 concurrent webhooks exhaust the connection pool (5 default)
 * - This queue ensures max N webhooks process at a time, keeping DB load controlled
 *
 * Features:
 * ✅ Deduplication — if same product webhook arrives 5 times, only process ONCE
 * ✅ Concurrency control — max 3 webhooks at a time (keeps DB pool healthy)
 * ✅ Immediate 200 OK — webhook returns instantly, Shopify never retries
 * ✅ Retry on failure — transient errors are retried with backoff
 * ✅ No Redis/Bull needed — pure Node.js in-memory queue
 */

const MAX_CONCURRENCY = 3; // Max concurrent DB operations (well under pool limit of 20)
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

// Queue: Map<productId, job> — Map ensures dedup (same productId = same slot)
const queue = new Map();

// Currently processing set — track in-flight jobs
const processing = new Set();

let workerRunning = false;

/**
 * Add a job to the queue.
 * If the same productId is already queued (but not yet processing), it gets updated in-place.
 * This is the "deduplication" — 5 webhooks for same product = 1 processing job.
 */
export function enqueueWebhookJob(productId, jobFn, label = '') {
  if (processing.has(productId)) {
    // Already processing — queue a follow-up so latest data gets saved
    queue.set(`${productId}_followup`, { productId: `${productId}_followup`, jobFn, label, retries: 0 });
  } else {
    // Dedup: same productId → overwrite with latest job
    queue.set(productId, { productId, jobFn, label, retries: 0 });
  }

  console.log(`CFP Queue: Enqueued [${label}] | Queue size: ${queue.size} | Processing: ${processing.size}`);

  // Kick off worker if not running
  if (!workerRunning) {
    runWorker();
  }
}

/**
 * Background worker — pulls jobs from queue, runs them with concurrency limit.
 */
async function runWorker() {
  workerRunning = true;

  while (queue.size > 0) {
    const available = MAX_CONCURRENCY - processing.size;

    if (available <= 0) {
      // Pool is busy — wait for a slot to free up
      await sleep(200);
      continue;
    }

    // Take up to `available` jobs from the front of the queue
    const batch = Array.from(queue.entries()).slice(0, available);

    for (const [key, job] of batch) {
      queue.delete(key);
      processing.add(key);

      // Run job in background (don't await — allows parallel execution up to MAX_CONCURRENCY)
      runJobWithRetry(job)
        .catch((err) => {
          console.error(`CFP Queue: Job [${job.label}] failed after all retries:`, err?.message);
        })
        .finally(() => {
          processing.delete(key);
        });
    }

    // Small yield to allow fired jobs to start before we check again
    await sleep(50);
  }

  workerRunning = false;
}

/**
 * Run a single job with retry logic.
 */
async function runJobWithRetry(job) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await job.jobFn();
      console.log(`CFP Queue: ✅ Job [${job.label}] completed on attempt ${attempt}`);
      return;
    } catch (error) {
      const isNonRetryable = isNonRetryableError(error);
      const isPoolExhausted = isConnectionPoolExhausted(error);

      if (isNonRetryable) {
        console.error(`CFP Queue: ❌ Non-retryable error for [${job.label}]:`, error?.message?.substring(0, 120));
        throw error;
      }

      if (attempt === MAX_RETRIES) {
        console.error(`CFP Queue: ❌ [${job.label}] failed after ${MAX_RETRIES} attempts:`, error?.message?.substring(0, 120));
        throw error;
      }

      let delay;
      if (isPoolExhausted) {
        // Pool full — wait longer for connections to free up
        delay = 5000 + Math.random() * 3000; // 5–8s
        console.warn(`CFP Queue: Pool exhausted for [${job.label}], waiting ${Math.round(delay)}ms... (${attempt}/${MAX_RETRIES})`);
      } else {
        // Transient error — exponential backoff
        delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 500;
        console.warn(`CFP Queue: Transient error for [${job.label}], retrying in ${Math.round(delay)}ms... (${attempt}/${MAX_RETRIES})`);
      }

      await sleep(delay);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const NON_RETRYABLE_CODES = new Set(['P2028', 'P2002', 'P2025', 'P2003']);

function isNonRetryableError(error) {
  return error?.code && NON_RETRYABLE_CODES.has(error.code);
}

function isConnectionPoolExhausted(error) {
  return (error?.message || '').includes('Timed out fetching a new connection from the connection pool');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get current queue status (for debugging/monitoring).
 */
export function getQueueStatus() {
  return {
    queued: queue.size,
    processing: processing.size,
    workerRunning,
  };
}
