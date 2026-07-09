/**
 * Retry utility - ONLY retries transient/network errors, NOT Prisma transaction timeouts (P2028)
 * P2028 is a sign of DB overload — retrying makes it worse.
 */
const NON_RETRYABLE_CODES = new Set([
  'P2028', // Transaction timeout — DB is overloaded, retrying amplifies the problem
  'P2002', // Unique constraint violation — retrying won't fix
  'P2025', // Record not found — retrying won't fix
  'P2003', // Foreign key constraint — retrying won't fix
]);

export async function withRetry(operation, maxRetries = 2, baseDelayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      // Don't retry non-retryable Prisma errors
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

      // Exponential backoff with jitter to avoid thundering herd
      const jitter = Math.random() * 500;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      console.warn(
        `CFP: Operation failed (attempt ${attempt}/${maxRetries}). Retrying in ${Math.round(delay)}ms...`,
        error?.message
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
