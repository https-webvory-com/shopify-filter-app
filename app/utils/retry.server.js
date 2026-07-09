/**
 * Retry utility with smart error classification.
 *
 * Use case: Webhook arrives, DB momentarily fails (restart/network blip) → retry → save succeeds ✅
 *
 * Error categories:
 * 1. NON-RETRYABLE: Data errors (unique constraint, not found) — retrying won't fix
 * 2. NON-RETRYABLE: P2028 transaction timeout — DB is overloaded, retrying amplifies the problem
 * 3. SLOW RETRY: Connection pool exhausted — DB is fine, just busy. Wait longer (5s) before retry
 * 4. NORMAL RETRY: Network blip, DB restart, transient errors — retry with normal backoff
 */

const NON_RETRYABLE_CODES = new Set([
  'P2028', // Interactive transaction timeout — DB overloaded, retrying makes it worse
  'P2002', // Unique constraint violation — retrying won't fix
  'P2025', // Record not found — retrying won't fix
  'P2003', // Foreign key constraint — retrying won't fix
]);

const isConnectionPoolExhausted = (error) => {
  const msg = error?.message || '';
  return msg.includes('Timed out fetching a new connection from the connection pool');
};

export async function withRetry(operation, maxRetries = 3, baseDelayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      // 1. Non-retryable Prisma data errors — throw immediately
      const prismaCode = error?.code;
      if (prismaCode && NON_RETRYABLE_CODES.has(prismaCode)) {
        console.error(
          `CFP: Non-retryable error (${prismaCode}), aborting retry.`,
          error.message
        );
        throw error;
      }

      if (attempt === maxRetries) {
        throw error;
      }

      let delay;
      let reason;

      if (isConnectionPoolExhausted(error)) {
        // 2. Pool exhausted — DB is fine, just too many concurrent requests
        // Wait longer (5-8s) to let other requests finish and free connections
        delay = 5000 + Math.random() * 3000; // 5-8 seconds
        reason = 'Connection pool exhausted — waiting for connections to free up';
      } else {
        // 3. Transient error (DB restart, network blip) — normal exponential backoff
        const jitter = Math.random() * 500;
        delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
        reason = 'Transient DB error — retrying';
      }

      console.warn(
        `CFP: ${reason}. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt}/${maxRetries})`,
        error?.message?.substring(0, 100)
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
