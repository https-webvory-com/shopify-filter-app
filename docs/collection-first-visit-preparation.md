# Collection first visits

The collection loader keeps its existing complete, immutable ranking contract.
It never substitutes an incomplete native page while merchandising prepares.

The background scheduler now discovers all local collection metadata for a shop,
then queues a separate public best-selling context for each collection in up to
four observed/configured markets. Discovery uses 100-row catalog pages every
four minutes. Private/customer/filter/token contexts never seed catalog work.
Each catalog replay is an individual priority-20 job; recent public warmups and
ranking refreshes use priority 10, and waiting visitor ranking jobs use priority
1. Worker concurrency remains one. An already running build cannot be preempted.

Recent visitor replay still retains only 40 registry entries. Complete public
ranking storage has a separate cap of 2,048 records and 64 MiB of encoded payload
per shop. Large payloads use lossless deflate/base64 encoding; legacy JSON remains
readable. The byte cap counts payload bytes, not Redis key/allocator overhead.
Order refreshes replace only their own old version. Eviction cannot delete
browsing sessions or queue data. Configuration and product freshness checks are
unchanged. The cache retains rankings for 24 hours and refreshes in background
using the existing policies.

Scalar/tag ranking scans request 10,000 projected products per batch instead of
1,000. Projections containing collection arrays retain 1,000-row batches; variant
projections retain 25. Ranking fields, filters, sort, comparator, metadata and
pagination are unchanged. Production heap-budget checks cover all three cases.

Variant-based rules now separate the sorted scalar scan from variant hydration
when the index supports document reads. The sorted search retrieves scalar/tag
fields in large batches; variants, options and images are then read by those
exact IDs in groups of 25. This avoids repeating the sorted collection search
for every 25 variant-bearing products. Search order, global merchandising order
and selected images remain identical to full ranking. Missing products during
hydration reject the build; existing storefront-page missing-product handling
is unchanged. Older adapters without document reads retain the previous path.

Disconnected shops without offline sessions no longer schedule new periodic
order/catalog work; already queued catalog replays for them are skipped. Existing
valid shops, visitor requests and retries retain their normal behavior.

Once a ranking is ready, the API skips ordinary product searches whose hits would
be discarded. Ranked collection facet queries request zero hits and use the
frozen sequence's exact count, avoiding an additional exhaustive hit-count query.
Search and unranked/manual collection queries retain their existing behavior.

Deployment starts a background fill; it does not instantly prepare the catalog.
New collections/markets, invalidation, evictions, unavailable workers, and an
insufficient worker-throughput budget can still cause pending responses. Verify
actual coverage and queue age before claiming all first visits are ready or
promising a universal four-second load. A fresh browser and a cold backend are
different conditions. Do not force visitor requests merely to warm a benchmark
target and then label the result an unseen-collection test.

This is an independent implementation informed by observed SoBooster browser
behavior. Its proprietary server ranking/cache architecture is unknown. No
Shopify extension or theme release is required for these backend changes.
