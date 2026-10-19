# Collection first visits

The collection loader keeps its existing complete, immutable ranking contract.
It never substitutes an incomplete native page while merchandising prepares.

The background scheduler now discovers all local collection metadata for a shop,
then queues a separate public best-selling context for each collection in up to
four observed/configured markets. Discovery uses 100-row catalog pages every
four minutes. Private/customer/filter/token contexts never seed catalog work.
Each catalog replay is an individual job that completes and publishes the full
ranking inside the worker before reporting success. It does not merely enqueue
a second build. Recent warmups, catalog preparation and ranking refreshes share
background priority 10. Small fact-backfill prerequisite jobs use priority 5,
so missing shared product inputs can be filled before expensive catalog builds.
Existing priority-20 catalog jobs are
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

## Maintained inputs and efficient query-time ranking

Supported anonymous best-selling collections can retrieve compact filtered
documents without asking search to sort the full native set again. Shopify's
complete ordered ID snapshot supplies native tie positions. At most 1,000
outside Include IDs are checked with the original filtered/sorted search to
preserve their exact base order. The existing merchandising comparator still
produces the complete immutable ID sequence before pagination; there is no
approximate first-page ordering or pagination against a changing live query.

This path checks engine settings for distinctness and restricted displayed
attributes and falls back to canonical
search for unsupported query options, private/filter contexts, other sorts,
missing browse support, unstable counts/duplicate IDs, more than 50,000
candidates, projections larger than 16 MiB, large outside sets, or failed outside
order validation. Browse pages contain at most 1,000 compact documents. No index
settings, ranking formula, response shape, theme asset or schema is changed.

Normal product writes now carry their version-bound rule facts in the same index
document when that optional projection fits 4 KiB. Those current facts need no
Redis lookup. Missing/stale projections still use the existing bounded Redis fact
store; missing facts on a visitor request never trigger full variant hydration.
Derived fact fields are excluded from the product-change fingerprint so a
metadata-only refresh cannot invalidate rankings. Original product/variant
inputs remain fingerprinted normally.
The visitor budget remains four seconds. The worker can populate only missing
facts from exact full product versions in batches of 25, using the canonical
matcher and SKU hydration. It checks shop, ACTIVE status and the source marker
before publishing reusable facts. Redis writes use bounded 25-command pipelines.
Overlapping collections reuse these shared facts instead of repeating variant
reads. Backfill never rewrites product documents or their source markers.
Completed prerequisite sweeps leave a one-hour cooldown so repeated scans cannot
continuously monopolize the background lane; changed product versions continue
to be maintained by their writers and repaired by individual ranking jobs.

An unchanged supported saved ranking can be renewed after checking all relevant
data/configuration revisions and the independent outside-Include base order.
This avoids rebuilding the entire collection every refresh interval. An update
during validation rejects renewal; product/rule/order changes, missing proofs and
unsupported contexts retain their previous rebuild/freshness behavior. Existing
immutable browsing tokens remain unchanged.
The same product-freshness guard also tracks outside-Include and explicit-pin
updates using the shop-wide revision, including Includes found in rule groups;
catalog and last-order reuse cannot bypass that check.

This removes repeated search sorting and variant reads from the supported fast
path, but still sorts compact IDs with the canonical comparator. It does not
claim constant-time ranking for arbitrary rules, instantaneous initial backfill,
unlimited cache coverage, or a universal four-second storefront load. Initial
shared-input coverage, worker throughput, engine/browser/network latency and the
existing retention budgets still need production measurement after deployment.

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

Local verification for maintained inputs and query-time ranking: 627 regressions,
the production build, 27 headless browser checks and focused 256 MiB heap checks
passed. Complete native/Include rankings, explicit missing pins, zero prices,
variant-selected images, SKU hydration, cancellation, restricted engine settings,
changing/missing/foreign product versions, cache limits and outside-product
revision changes are covered. Real Redis checks verified 80 pipelined writes,
exact source versions, bounded profiles and tenant isolation. Browser fixtures
verified the filtered compact-input path with the worker paused, plus an
unchanged ranking after two simulated hours. These are local fixtures, not a
post-deployment Feather timing or proof that every production context is ready.


Cards-first delivery (local implementation, 2026-10-19):

Anonymous, unfiltered first pages using best-selling, page 1 and 25 cards now
opt into collection-cards-v1. This returns the existing correctly ordered cards
and complete lossless configuration without querying facets. The browser renders
cards immediately, then fetches filters/counts using the same frozen ranking
token. A failed filter response leaves cards visible and offers Retry filters.
Aborted requests cannot overwrite a newer sort/page. Existing clients, search,
customer-specific rules, other sorts and filtered requests retain full delivery.
Full ranked responses read facets and page products concurrently.

Catalog/recent warmups also materialize card-only snapshots. These have a 24-hour
maximum lifetime, 1024 entries and 24 MiB per-shop budget (including ID/handle
aliases), and a 128 KiB compressed per-entry limit. Capacity is bounded; this
does not assert that all collections/markets fit or are already prepared.
Configuration, local product versions, hard invalidation epochs, native order
revision, backing full sequence/metadata, and current first-page product documents
are validated before reuse. Include/pin contexts also validate the global product
version. Facets are never stored in this snapshot. Background rendering creates
no shopper sessions; actual visits get immutable, URL-specific browsing tokens.
A failed/slow optional lookup falls back within its 500 ms budget. There are no
application timeout increases, ranking formula changes, or schema migrations.

Unlike the earlier backend-only changes, this implementation also updates
collectionFilterPro.js and collectionFilterPro.liquid. Both the backend and the
Shopify extension assets must be released before the preview uses this path.
Changes remain local. The two-second target refers to correctly ordered visible
cards; images and market prices still load independently. A cold missing ranking
uses existing preparation and can exceed the target. Network/Shopify HTML time
also counts toward live timing. Controlled fixture results cannot establish a
universal two-second production result or proprietary SoBooster internals.

Schedule safety: snapshot reads check currently enabled collection-rule schedules
in parallel with Redis state. Future rule activation and expiry invalidate reuse
even without a settings write. A schedule boundary occurring during the initial
request also prevents publishing a snapshot from that request.

Browser verification: all 28 cases passed. In the controlled local first-visit
fixture, cards rendered in 1555 ms with a 3000 ms facet delay, and failed facets
preserved cards with a working retry. The deferred-asset case rendered cards in
1144 ms with 1000 ms injected asset latency and 700 ms API latency. These are
fixture timings, not live-store benchmarks. Evidence is in ignored
scratch/collection-headless-results.json. Isolated real Redis checks passed for
bounded retention, expiry, visitor-only sessions and protected session keys.

Final local validation: 636/636 regressions, production build, 28/28 browser
cases and isolated real-Redis retention checks passed. No commit, push, backend
deploy or Shopify release was performed.
