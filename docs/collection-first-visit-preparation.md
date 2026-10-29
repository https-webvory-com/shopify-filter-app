# Collection first visits

The collection loader keeps its existing complete, immutable ranking contract.
It never substitutes an incomplete native page while merchandising prepares.

The background scheduler now discovers all local collection metadata for a shop,
then queues a separate public best-selling context for each collection in up to
four observed/configured markets. Discovery uses 100-row catalog pages every
four minutes. Private/customer/filter/token contexts never seed catalog work.
Each catalog replay is an individual job that completes and publishes the full
ranking inside the worker before reporting success. It does not merely enqueue
a second build. Catalog discovery uses background priority 10. Recent visitor
contexts and shop dispatch sweeps use priority 5. Small fact-backfill prerequisite jobs use priority 5,
so missing shared product inputs can be filled before expensive catalog builds.
Existing priority-20 catalog jobs are
promoted during discovery. Waiting visitor jobs retain priority 1. Worker
concurrency remains one; an already running build cannot be preempted.

Product/order events coalesce into one pending global sweep per shop, with a
second job slot for updates arriving during an active sweep. Different product
membership batches no longer create distinct warmup jobs. Global coverage is
required because Include rules and explicit pins can depend on products outside
the changed product's native collections. A sweep only dispatches individual
contexts; it does not render up to 40 pages while holding the worker. Old queued
scope batches are folded into one new sweep per shop after worker restart.
Cold preparation is queued before attempting the optional four-second direct
path. A worker job checks whether another producer already published matching,
event-versioned inputs before repeating that build. Product/configuration/data
freshness guards and complete immutable ordering remain in force.

The Silk Prom Dress audit on 2026-10-20 found a saved ranking rejected for changed
products, a direct-build timeout, and 2,075 queued background jobs. The first
desktop visit showed real cards at 18.485 seconds; the subsequent visit with a
fresh browser context but a prepared backend showed cards at 2.431 seconds.
These queue changes require backend **and worker** deployment. They do not prove
a two-second live result. Validate readiness with
`node scripts/check-collection-loading-readiness.mjs --shop STORE.myshopify.com`,
then measure separate fresh desktop/mobile visits, including a visit after a
relevant product update. Report first real cards, images and verified prices
separately. Do not reset production caches or modify merchant themes for testing.

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

### Exact external dependencies and operational checks

New supported public rankings record a bounded union of exact Include-tag and
configured explicit-pin dependencies. Configured pins remain dependencies when
currently unavailable, so an eligibility change can reintroduce them correctly.
Product webhooks persist original tags across retries and invalidate the union
of before/after tags and the product ID. Incremental sales updates write only
the changed products and derive dependency proofs from visible index documents.
Unsupported Include predicates, malformed/missing proofs and bulk writes retain
broad invalidation. Legacy rankings continue using their original global proof
until rebuilt; legacy first-page copies take a canonical validation pass before
being saved under the new card policy.

Dependency versions use opaque unique epochs. Missing versions fail validation;
reinitializing a lost key cannot recreate its previous identity. Counters are
created only for declared dependencies, and ordinary product events update only
existing dependency keys. Native membership, configuration, schedule, order,
current-document and ten-minute changed-product guards remain in force.

Newly validated cards expire according to their own creation time, independently
of an unchanged ranking's original age. Each later card read still checks the
backing ranking and current documents. Large outside Include sets now abandon
the optional browse path as soon as its proof limit is exceeded, avoiding a full
browse followed by a repeated canonical scan. Worker concurrency stays at one.

`collectionPreparationTelemetry:SHOP` holds bounded event/rejection counters and
300 recent samples with queue-wait, build and card-read durations. Optional metric
failures cannot block products. Audit known contexts using:

```sh
node scripts/check-collection-loading-readiness.mjs --shop STORE.myshopify.com --metadata-only
node scripts/check-collection-loading-readiness.mjs --shop STORE.myshopify.com --handle COLLECTION --require-ready
```

The first command checks metadata coverage without engine reads. The second
validates actual first-preview documents and exits nonzero for missing contexts.
Both are read-only and report their validation scope. Neither establishes a live
two-second browser SLA or verifies unpublished/undiscovered market combinations.

Durable snapshots store existing deflate bytes in a versioned binary envelope,
avoiding base64 storage overhead. Readers accept both formats and still enforce
the original decoded-entry limit. Existing snapshots can be compacted after both
web and worker are upgraded:

```sh
node scripts/compact-collection-snapshots.mjs --shop STORE.myshopify.com
node scripts/compact-collection-snapshots.mjs --shop STORE.myshopify.com --apply
```

Compaction preserves ranking contents, aliases, validation/expiry timestamps and
eviction age. It compares the inspected payload and timestamp under the same
per-shop storage lock, so concurrent updates are skipped. An older binary reader
cannot restore new-format snapshots; canonical requests still provide fallback.
New ranking saves also retain only the latest order version within an identical
configuration/rule/filter context. A newer validated write wins over a delayed
older save; other contexts and shops remain separate.

Recurring recent-page sweeps dispatch at catalog priority 10 rather than
repeatedly promoting hot pages to priority 5. This lets unseen contexts make
FIFO progress. Explicit changed-card refresh priority 5 and visitor ranking
priority 1 remain in force; the small sweep-dispatch job still has priority 5.
Each catalog job first probes existing complete cards with current-document,
epoch/order/configuration and schedule validation. A verified hit finishes
without reconstructing the ranking specification or creating a shopper session.
Misses, unproven responses and probe failures use normal canonical preparation.

### Content updates and internal score writes

Order processing uses a separate `scores` invalidation signal. Existing general
product/search counters still advance, but public collection rankings use a
content revision plus separately declared sales dependencies. Native best-selling
positions come from Shopify; our sales scores cannot reorder those positions or
fixed native pins. Only the bounded, proven outside candidate IDs declare score
dependencies. Unknown/bulk writes, unproven outside sets and other ranking modes
keep conservative broad score invalidation. True product content/stock changes
still invalidate content and Include/pin dependencies normally.

Each build captures the global score epoch before scanning and verifies it before
publishing. Reads verify declared score epochs, and lost epochs fail validation.
Legacy rankings can adopt the new proof without rescanning only before the first
new score event, when their old native/content counters, configuration/data epochs
and canonical outside-order proof still match. Source age is preserved; otherwise
the worker rebuilds. Score-only product webhooks use the same score path, while
derived index source hashes alone do not masquerade as product edits.

Backlog retirement defaults to a read-only audit:

```sh
node scripts/retire-superseded-collection-jobs.mjs --shop STORE.myshopify.com
node scripts/retire-superseded-collection-jobs.mjs --shop STORE.myshopify.com --apply
```

Apply schedules a replacement global sweep before removing legacy warmups and
removes preparation jobs only for obsolete configuration revisions. Active,
current, catalog and other-shop jobs remain. BullMQ enforces locked-job safety.

`scripts/enable-collection-http2.py` is an optional, dry-run-by-default server
helper for the existing app virtual host. It accepts only that host under
`/etc/nginx`, checks nginx HTTP/2 support, backs up the original file outside the
enabled-sites directory, tests configuration and restores it if reload fails.
`--self-test` runs without touching server configuration. Browser protocol and
fresh-load measurements must confirm the effect after application.

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
A failed/slow optional lookup falls back within its 1.2-second budget. There are no
application timeout increases or ranking formula changes. The durable loading
increment below adds an additive database table and migration.

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

Previous cards-first validation: 636/636 regressions, production build, 28/28 browser
cases and isolated real-Redis retention checks passed. No commit, push, backend
deploy or Shopify release was performed.

### Durable loading and earlier browser startup

The current local increment saves disposable public ranking/card copies in
`CollectionLoadingSnapshot`. Redis remains the first lookup; a missing payload
can fall back to PostgreSQL only when its generation and invalidation history
are still present and current. A Redis reset rejects old database copies rather
than assuming missing counters mean no changes. Product, configuration, order,
scheduled-rule and first-page document validation still apply. This does not
turn a stale ranking into a ready ranking or finish the catalog warmup queue.

Database copies expire within the original 24-hour freshness window and have a
per-shop limit of 8,192 entries / 256 MiB, with at most 2 MiB per entry. Budget
decisions use a PostgreSQL transaction and per-shop advisory lock across web
and worker processes. Cards retain their stricter 128 KiB construction limit.
ID/handle aliases point to a single canonical card payload. Missing tables or
optional storage failures fall back to normal collection delivery.

The collection renderer now loads asynchronously and waits for complete widget
markup instead of waiting for all deferred theme scripts. It supports market
pricing and wishlist dependencies that arrive after cards. The optional
**Faster collection loading** head embed additionally starts the matching
market/locale request before body markup. Its early response is consumed only
when the body request matches; changed filters, sort, customer or market context
use their corresponding request.

Local verification commands:

```sh
node tests/collection-loading/run-postgres-snapshots.mjs
node tests/collection-loading/run-headless.mjs
node scripts/run-regression-tests.mjs
npm run build
```

The PostgreSQL check requires local PostgreSQL binaries (`POSTGRES_BIN`, default
`C:/Program Files/PostgreSQL/18/bin`). It creates a disposable loopback cluster
and separate Prisma client under `scratch`, applies the exact migration, checks
real transactions/concurrent budget enforcement, and stops only that cluster.
It does not read `DATABASE_URL` or connect to production. Cluster logs remain
under `scratch` for inspection.

Release requirements, for a future authorized deployment:

1. Include all new utility/service/theme files and
   `prisma/migrations/20261019000000_collection_loading_snapshots/migration.sql`.
2. Apply the additive schema and regenerate Prisma before the backend and worker
   use this model. This repository's normal startup uses `prisma db push`; a
   migration-managed installation must apply the checked-in migration instead.
3. Release both backend/worker and Shopify theme-extension assets. Enable the
   **Faster collection loading** app embed on the selected theme for the extra
   head request; publishing assets alone does not enable a new embed.
4. Check actual card readiness, not queue completions or cached ID counts:
   `node scripts/check-collection-loading-readiness.mjs --shop STORE.myshopify.com`.
   `--limit 10` gives a bounded sample. The probe creates no shopper sessions or
   preparation jobs and performs no cache/schema repairs. It reports coverage
   of locally known collections in observed/configured markets only, not proof
   that every Shopify-published collection or market is ready.
5. Verify first/repeat visits, market prices, wishlist, filters and pagination
   on the selected theme and measure live cards independently from facets.

Current scope is local verification only. No backend/worker deployment, database
change on production, theme publication or embed activation is authorized by
this local completion request.

Local completion verification (2026-10-19): 650/650 regressions, 29/29 actual
storefront-asset browser fixture checks, 8/8 real PostgreSQL checks, production
build and Prisma schema validation passed. The repeat-visit browser test now
sets up two visits with identical settings independently of the preceding
wishlist-dependency test. PostgreSQL verification includes the exact migration,
GIN index, Prisma byte/array round trips, two-client advisory-lock concurrency,
per-shop budgets/expiry, reset rejection, missing-table fallback and rollback.
These local results do not establish live-store timing or complete live catalog
readiness. The user explicitly selected local-only completion.

### Product-card preparation retries

A catalog job now completes only when its cards return HTTP 200 with a
`X-CFP-Collection-Cards` value of `stored` or `hit`. A ready ranked ID list alone
does not count as complete. Card misses, pending responses, render/storage errors
and missing readiness headers fail that same catalog job so BullMQ can retry.
New catalog jobs have five attempts with exponential backoff starting at ten
seconds. Retries release the single ranking lane while delayed, allowing other
collections and higher-priority visitor jobs to proceed. Existing queued jobs
retain their original retry options; the stricter completion check applies when
they execute. No queue reset or duplicate preparation job is needed.

Recent-context sweeps still continue past an unavailable card context and enqueue
the normal per-collection catalog jobs. A periodic sweep can reschedule exhausted
catalog jobs after the existing failure cooldown; five attempts is a bound on
each job, not a permanent ban on preparing that collection.

Trusted background card requests now probe validated snapshots without creating
shopper sessions. A valid hit avoids the remaining rendering pipeline. A stale
snapshot still falls back to canonical preparation and cannot bypass product,
order, rule or configuration validation. This change does not enable the theme's
head embed, alter ranking rules, or guarantee readiness for every market.

Additional queue verification:

```sh
node tests/collection-loading/run-card-preparation-retries.mjs
```

This uses the existing Redis test harness with an isolated UUID namespace. It
exercises the actual catalog warmup service and BullMQ retries, successful reuse,
visitor priority, retry exhaustion and preservation of protected session keys.
It never clears or modifies merchant queue/cache keys.

Local validation for this retry increment: 652/652 regressions, 29/29 browser
fixture checks, three real BullMQ lifecycle checks, production build, syntax
checks and `git diff --check` passed. No schema/theme change is needed for this
increment. Deploy the backend and worker together when authorized; no deployment
or merchant-rule changes were performed during implementation.

### Immediate card rendering and compatible snapshot reuse

The initial response contains image/title inputs for every currently validated
card. A saved snapshot can validate its first five independently; a canonical
response that already has the full page returns all 25. The small head loader
renders every returned card without waiting for the main widget, prioritizing
the first five images. The token-scoped follow-up supplies prices, filters and
the remaining cards. No timer delays product rendering.

Soft product epochs now follow the canonical ranking's existing ten-minute
reuse window. Every displayed product still requires current-document
validation. Configuration, hard data epochs, schedules, order revisions,
sequence identity and changes during validation continue to reject reuse.
Older snapshots retain 25-document validation until they are rebuilt with a
separate first-five fingerprint. This does not extend ranking freshness.

This is a public app: delivery must use its theme extension and backend. Do not
patch merchant layouts, copy loaders into merchant snippets, or require manual
theme changes. The first cards mount only inside the installed app block.

Browser fixture timings verify behavior with controlled delays; only fresh
visits to the deployed storefront establish actual first-card/image times.

### Early requests and pending ranking recovery

The preloaded extension loader can start an anonymous first-page request from
Shopify's shop, country and locale globals before its Liquid metadata arrives.
It does not display or preload product images until that metadata confirms the
same market and customer scope. A mismatch aborts the speculative request and
starts the correctly scoped one. Matching requests share the same promise with
the full widget, including its existing claimed-request protection.

A 202 response no longer hands all progress back to the full widget. The small
loader retries independently, respecting Retry-After up to one second, and
mounts the ready image/title/link response immediately inside the app block.
Titles do not wait for image downloads, market prices, filters or full-widget
startup. The existing 30-second fetch deadline and context cancellation remain.
There is no added wait on a successful response and no new card-count cap.
When the full widget claims a still-pending request, it takes over the existing
bounded retry loop instead of starting a second timeout window after the loader.

For an already usable ranking, a shopper-triggered refresh now has priority 5,
ahead of catalog preparation at 10 and behind cold visitor requests at 1. An
existing queued refresh is promoted rather than duplicated; later bulk warmups
cannot demote it. Ranking freshness, eligibility, pins and rule ordering retain
their existing checks. These changes require backend/worker and extension
deployment together; they do not modify merchant themes or merchant settings.

### Storefront asset build and entry budgets

Run `npm.cmd run build:storefront` after editing `collectionLoading.js` or
`collectionFilterPro.js`. This writes their committed `.min.js` deployment
assets and the matching inline loader snippet. Both `npm.cmd run build` and
`npm.cmd run deploy` run this generation automatically. Direct
`shopify.cmd app deploy` uses the already generated, committed assets; include
all generated files when committing. Regression tests reject stale assets.

App block schemas register the small `collectionWidget.js` entry and the
minified early loader, each below 10000 bytes. The widget entry waits for its
app block, then loads the version-scoped, minified full widget from Shopify
CDN once. It does not wait for interaction or change ranking/card semantics.
The separate early loader remains independent of full-widget loading.

The backend preconnect is a connection hint, not an externally hosted static
asset. Only those two Liquid lines have a documented `RemoteAsset` exception;
asset-size checks and other remote-asset checks remain enabled. The redundant
explicit Shopify CDN preconnect was removed. Verify without publishing with
`shopify.cmd app build --no-input --no-color`.

### Saved-card refresh and body/head startup race

Saved-card hits return before the canonical ranking path. They now report real
public visits to the bounded registry and, when their ranking has known product
changes, enqueue/promote the same
one-context catalog job at priority 5. This work does not delay card delivery.
Fresh unchanged rankings do not enqueue rebuilds, probes do not enqueue visits,
and failed jobs retain their existing cooldown/backoff. All snapshot, product,
schedule, order, tenant and freshness validation still runs before delivery.

When theme resource timing lets the inline body fetch start first, the head
loader attaches its independent renderer to that already-running promise too.
It previously retained only the request identity, leaving available products
waiting for the larger widget. Adoption cannot display an aborted or replaced
request and does not start another fetch.

Fresh live checks on 2026-10-20 for preview `plus-size-long` showed saved-card
hits with titles at 4266ms desktop and 2723ms mobile, still above target. The
observed preview served extension 357. Separately, the user's existing Plus Size
Maxi Dresses tab recorded repeated 202 pending responses until roughly 16s.
That is a backend-readiness wait, distinct from image/price rendering. These
local changes do not establish live two-second performance; backend/worker and
extension deployment and fresh first-visit measurement remain required.

### Database ranking reuse on change events

Public rankings use their durable database sequence after Redis expiry or
eviction, including beyond the old one-day retention interval. Reads still
verify configuration, product/data versions, order identity, shop, market and
reuse eligibility. Redis storage TTL and ranking validity are separate. An
unchanged ranking no longer recalculates just because eight minutes elapsed,
its Redis TTL is low, or a catalog warmup tick runs. Identical ranking saves
also skip database updates. Durable byte and entry budgets remain enforced.

Product, collection/order, pinning/merchandising, settings, hard data and relevant
schedule changes still invalidate or rebuild affected inputs. Known stock or
product changes do not gain an extended stale-data window. Missing/corrupt
rankings and lost invalidation history still need a verified rebuild. Card
snapshots retain their own independent freshness and current-document checks.

Successful sales-score index updates also emit product-version changes for the
affected collections and the global outside-Include context, after their Meili
tasks complete. This covers sales-driven order changes without product-edit
webhooks. New or verified rankings carry `rankingEventsVersion: 1`. Legacy
outside-candidate snapshots undergo one canonical verification/adoption or
rebuild during this upgrade; they are not blindly given indefinite reuse.

### Prioritized loader and progressive card transport

The early-loader preload, early scripts and first-page fetch use high-priority
browser hints. Quick-view CSS is no longer preloaded alongside the critical
product request. These hints cannot force execution before arbitrary merchant
scripts or before Shopify delivers the app embed; no merchant theme is edited.

The early loader negotiates newline-delimited preview records when supported.
The backend validates the ranking and displayed documents first, then sends
metadata and each ready card in order, with sync-flushed gzip when accepted and
`X-Accel-Buffering: no`. The reader appends complete records immediately instead
of waiting for the entire response, preserving earlier card DOM nodes. Images,
prices and facets remain independent. Ordinary JSON and older backends remain
supported. No production timer deliberately stages delivery; test-only tail
delays prove that the first card appears while later bytes are still pending.

### Independent complete pinned cards

Clients opt in with the safelisted Accept token
`application/x-cfp-pinned-prefix-v3`; older clients retain the complete-ranking
protocol. On an anonymous, unfiltered native best-selling preview request,
up to 25 eligible explicit pins can prove a leading prefix without waiting for
the complete ranking, its worker or an initially missing native-order snapshot.
An unavailable full-ranking queue does not suppress an independently proven
prefix; the canonical follow-up retains its error/retry behavior. The existing route owns active/stock and
imported membership eligibility. Canonical explicit pins override merchandising
Exclude conditions and tag scores in this mode. Other sorts decline this path.

The first 25 eligible configured pins are read from current index documents, in pin order.
Missing, inactive, foreign-shop, incomplete, duplicate, unknown-price or
nonpositive-price proofs decline. In particular, a free earlier eligible pin
is not silently skipped to manufacture a prefix proof. The canonical
zero-price partition uses synced base prices; this does not certify contextual
market prices. Displayed prices keep their existing verification requirement.
The same merchandising code computes pin images and metadata on this bounded
set, and its resulting IDs must exactly match the configured eligible prefix.

The response is `200`, `X-CFP-Collection-Cards: prefix`, with
`collectionRankingStatus: prefix-ready`, complete pinned cards, a null total and no browsing
token. It is never saved as a complete ranking or card snapshot. The browser
retains these cards while canonical page one completes, then adopts that
ranking's token. With 40 pins, page one stays at 25 cards. Load more requests
page two, which starts with the remaining 15 pins, then the next ten ranked
products. No second page is fetched or displayed automatically. Pagination is
unavailable until canonical preparation completes. With fewer than 25 pins,
the proven prefix stays visible while ranking fills the rest of page one.
Cards include normal variants, swatches and product actions; market prices are
verified independently through the existing pricing path. Non-pinned initial
pages also negotiate complete card data. Only image/title markup needs the
early renderer; the full widget upgrades it without waiting for ranking.

Input versions cover shop, market, sort, pins, rules/configuration, native-order
revision, schedules, content/hard-data counters and runtime generation. Checks
run around preparation and before delivery without loading a saved full ranking.
Responses remain no-store. A bounded, ten-minute Redis proof stores only the
served IDs and input version for shadow comparison. A later canonical result
logs match, changed-input skip, or mismatch with position; a mismatch disables
that input version's head path for an hour. Proof and decline reasons are
observable; optional comparison failures must not break canonical ranking.

This is deliberately partial coverage: it cannot fill an unpinned remainder
under arbitrary tag scoring. Collections without provable pins retain canonical
preparation. Initial responses always contain at most 25 complete cards;
later configured pins stay in canonical pagination. Report cold proven heads, cold declines, warm
requests, canonical first-page completion and verified-price timing separately.
Browser-fixture timings do not establish the deployed two-second requirement.

The v3 complete-card protocol validates all 25 documents on saved-card hits as
well. The legacy five-document preview shortcut is reserved for older clients;
it must never enable page-two pagination after sending only five complete cards.
