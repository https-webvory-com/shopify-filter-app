export function syncErrorMessage(error) {
  const text = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || error?.cause?.code || "").toLowerCase();
  if (/stalled more than allowable|missing lock|lock renewal/.test(text)) return "The sync worker was interrupted. Saved progress is retained and can be resumed.";
  if (/disk full|no space|enospc/.test(text + code)) return "The server is out of disk space. Sync cannot continue until space is available.";
  if (/429|throttl|rate.limit|quota|resource_exhausted/.test(text)) return "The service request limit was reached. Sync will retry after a short wait.";
  if (/unauthor|access denied|permission|invalid.api.key|access token|401|403/.test(text)) return "A service rejected access. Check the store connection and service credentials.";
  if (/database|prisma|p1001|p1002|p2024|p2028/.test(text + code)) return "The database could not complete this batch. Saved sync progress is retained.";
  if (/fetch failed|timeout|timed out|econn|enotfound|eai_again|502|503|504|unavailable/.test(text + code)) return "A service could not be reached. Saved sync progress is retained.";
  if (/pagination stopped|unread products/.test(text)) return "Shopify pagination stopped before all products were read. Saved progress is retained.";
  if (/index|meili/.test(text)) return "Search indexing failed. This batch has not been marked as synced.";
  if (/sales data|orders/.test(text)) return "Products were processed, but the sales ranking update did not finish.";
  return "Sync encountered an error. Saved progress is retained; contact support if retries fail.";
}

export function syncIssueForJob(job) {
  if (!job || job.status === "COMPLETED") return null;
  if (!job.lastError && job.status !== "FAILED") return null;
  return {
    message: job.lastError || "The previous sync stopped before completing.",
    retrying: job.status === "IN_PROGRESS",
    retryCount: job.retryCount || 0,
    processed: job.productsProcessed || 0,
  };
}


export function productSyncJobWhere(shop) {
  return { shop, OR: [
    { kind: "PRODUCTS" },
    { kind: "BULK_PRODUCTS" },
    // Old sales jobs have no product cursor; do not treat them as product syncs.
    { kind: null, totalProducts: { not: null }, OR: [{ cursor: { not: null } }, { productsProcessed: 0 }] },
  ] };
}


export function isCompletedSyncTransition(previous, current) {
  return Boolean(previous?.id && previous.id === current?.id && previous.status === "IN_PROGRESS" && current.status === "COMPLETED");
}
