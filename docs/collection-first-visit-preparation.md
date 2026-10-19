# Collection first visits

The collection loader keeps its existing complete, immutable ranking contract.
It never substitutes an incomplete native page while merchandising prepares.

The background scheduler now discovers all local collection metadata for a shop,
then queues a separate public best-selling context for each collection in up to
four observed/configured markets. Discovery uses 100-row catalog pages every
four minutes. Private/customer/filter/token contexts never seed catalog work.
Each catalog replay is an individual job that completes and publishes the full
ranking inside the worker before reporting success. It does not merely enqueue
a second build. Recent warmups, catalog preparation, fact sweeps and ranking
refreshes share background priority 10, so repeated maintenance cannot jump in
front of an older unseen collection. Existing priority-20 catalog jobs are
promoted during discovery. Waiting visitor jobs retain priority 1. Worker
concurrency remains one; an already running build cannot be preempted.

Pending Shopify order snapshots and superseded configurations cause catalog
jobs to retry rather than report readiness. Fresh rankings are reused without
rebuilding. Product/rule/order warmups also schedule affected catalog collections
in known public markets even when they have no recent visitor URL. A successful
job logs `CFP: collection catalog ready` only after the API confirms completion.

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

## Reusing saved work after invalidation

Configuration cache invalidation retains bounded prepared sequences and their
retention accounting. Current configuration is still read under its new revision;
an old revision is never blindly served. A compatibility pointer matches the
complete current ranking inputs (query/filter scope, resolved rules, pins,
settings, merged values, sort and Shopify order), excluding only the revision
number and rule/settings `updatedAt` bookkeeping. Matching saved IDs/metadata
can be copied into the new revision without scanning products. Source preparation
time is preserved, so this does not extend the existing product-freshness window.

Cross-revision reuse is enabled for Shopify-backed best-selling order. Native
products require no index search. Outside Include products carry a saved base-ID
order, which is rechecked with a small ID-only sorted query before reuse; this
detects sales-score ordering changes that do not use product webhooks. Proofs
are bounded to 1,000 outside candidates with a two-second query budget. Other
sorts, missing legacy proofs, changed outside order and oversized proofs rebuild
conservatively. Fixed explicit pins retain their existing placement.

Reuse also checks collection product revisions and explicit data invalidations.
Includes and explicit pins check the shop-wide product revision because they can
draw products from outside the collection. Collection metadata updates/deletes
invalidate their own data scope. Full syncs and membership repairs that resync
complete product records conservatively invalidate the entire catalog data scope.
Actual rule, pin, filter, ordering or eligibility changes still require new work.

Compatibility pointers are capped at the same 2,048-entry retention limit and
expire after 24 hours. They reference existing bounded ranking payloads. Missing
products block compatible copies until a verified rebuild, preventing resurrection
of an obsolete first page. Exact legacy records can be probed across at most 16
prior revisions when no data epoch changed; unsupported legacy cases rebuild.
Already deleted/expired rankings cannot be recovered by this change.

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

Local verification for completed catalog jobs: 593 regression tests and the
production build passed. All 25 browser fixture checks passed, including a
background build before any visitor, followed by a single HTTP 200 product
response with the worker paused and no additional build. Fixture timings are
not proof of live catalog coverage or live page-load timing.

Local verification for compatible saved-ranking reuse: 607 regression tests,
the production build, and all 26 browser fixture checks passed. The added browser
case retains an unchanged ranking through a configuration refresh, then serves
the first visitor with the worker paused and no new build or pending response.
Isolated real-Redis reuse checks also verified scoped/bulk invalidation guards,
bounded compatibility pointers, and protection of browsing-session keys.
All 11 existing real-Redis/BullMQ regression checks passed as well.
