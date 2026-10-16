# Collection order refresh isolation

Best selling collections need a complete Shopify BEST_SELLING ID snapshot before
the first page can be ranked. These refreshes use `collectionOrderQueueV1`, with
one independent BullMQ consumer started alongside the existing background workers.
Product and collection webhooks remain on `webhookQueue`; full ranking preparation
remains on `collectionRankingQueueV2`.

The background runner checks readiness and closes all four workers on shutdown.
Refresh jobs retain deduplication, retry backoff and failed-job cooldown. The
existing snapshot keys, revision hashes, Shopify pagination, product eligibility,
pinning and merchandising comparators are unchanged. Last successful snapshots
remain usable while a refresh runs or fails. The first visit without a snapshot
still waits for the correct order rather than showing an alternate sequence.

No catalog sync, schema migration, theme publication or queue deletion is needed.
After deployment, new requests enqueue missing/stale snapshots in the independent
queue, even when an older refresh is waiting on the legacy webhook queue. Legacy
jobs remain supported and are allowed to drain normally. Existing public-context
warmups continue at worker startup and every four minutes; unknown collections
are prepared on demand. Separate queues remove webhook head-of-line blocking,
but Shopify throttling, unavailable workers and ranking preparation can still
delay requests.
