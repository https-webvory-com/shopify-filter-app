# Country availability

Collection eligibility can use Shopify Storefront `Product.availableForSale` in
an explicit `@inContext(country: ...)` request. This applies even when the global
**Show only in-stock products** switch is off. It is product-level sellability;
market price verification and the existing variant-selection rules remain
separate.

## Activation

1. Apply `20261026000000_market_availability` and generate the Prisma client.
   The existing deployment's schema setup must finish before the new web and
   worker processes start. The migration only adds two tables.
2. Deploy the backend/worker and Shopify app configuration together. The TOML
   declares `unauthenticated_read_product_listings` as an optional scope.
3. Open **Settings → General → Country availability** and select **Connect
   country availability**. Approve Shopify's permission dialog. The server
   verifies the granted scope, reuses or creates its own Storefront token, and
   checks that the token can see products before enabling the connection.

No manual API key is required. The token is stored separately from public filter
settings; the setup loader exposes only countries and the connection date.
Stores without a connection retain their existing behavior.

## Preparation and updates

- All countries returned by Shopify's `localization.availableCountries` are
  queued, rather than a fixed India/US list. Background discovery checks for
  added or removed countries every 12 minutes. Reconnecting also refreshes the
  list. Discovering a new country preserves unchanged countries' stock proofs.
- Country availability has its own queue and two workers, separate from the
  collection-ranking queue. An initial country scan reads the complete catalog;
  subsequent product/inventory webhooks normally query only changed products.
  A periodic full refresh catches changes without a product webhook.
- Inventory webhook processing records a stock change even if global product
  quantity or availability did not change. A Redis operation atomically records
  the event and its epoch. Per-country locks and epoch checks prevent a racing
  scan from becoming a current proof. Interrupted full scans can retain a base
  for delta recovery without serving it as current.
- Unchanged eligible IDs retain the same proof and do not request a country
  collection rebuild. Changed eligibility schedules that country's catalog
  preparation, including collections without recent visits.

The existing `CollectionLoadingSnapshot` published rows still contain the first
50 complete eligible cards, complete collection counts/facets and the full
canonical ID sequence. Country remains part of their request key. The first page
contains 25 cards; Load more requests the next 25. Explicit pins are intersected
with country eligibility before ranking and cannot reintroduce unavailable
products.

Every working/published card copy carries its country availability proof. An
obsolete copy falls back to preparation; page-two tokens from an obsolete proof
or another country receive HTTP 409 so the client restarts page one. An
unprepared country returns HTTP 202, not a successful empty result or a global
stock fallback. Malformed/unavailable Shopify responses never become complete
availability snapshots.

## Loading cost and limits

A prepared visit checks small cached proof metadata before using the saved page.
It does not call Shopify for stock, read the full country ID list, or rebuild the
collection ranking. Full ID lists are loaded only when a saved page cannot be
used and eligibility must be applied to ranking and facets. More countries add
background traffic, storage and preparation work; they do not add per-card
Shopify requests to prepared visits.

The first preparation or a known stock change can return pending until a
consistent replacement is ready. Shopify webhook delivery, worker processing,
and publication introduce a delay. This is not a zero-delay stock guarantee or
proof that cold visits meet the existing two-second performance target. Browser
timings from fixtures must not be reported as production latency.

## Validation

- `node --test tests/search/*.test.mjs`
- `node tests/market-availability/run-database.mjs` uses a disposable loopback
  PostgreSQL database and stops its owned fixture after testing.
- `node tests/collection-loading/run-headless.mjs --match=country` exercises the
  real collection API/renderer with fixture Shopify eligibility, country
  publications, 25→50 cards, retained first-page DOM, country switching and stock
  refresh. It asserts a saved-country visit does not rescan ranking candidates.
- `npm.cmd run build`

The new permission and automatic token flow require a deployed Shopify app
version before live activation can be verified. Local fixtures do not establish
that the deployed store has approved the permission or prepared all countries.

## Deployment readiness checked on 2026-10-26

The country worker is included in the dedicated runner's readiness and graceful
shutdown lists and in the production-bundle startup smoke test. A missing country
worker prevents the ready file from being published. The Docker build context
excludes Git and local agent/AWS metadata.

Validation on Node 20.20.2: 880 combined search/webhook/sync tests passed; the
production build and built web/worker startup passed; all three 256 MiB heap
memory scenarios passed. Shopify CLI app build and Theme Check passed. Local
Docker is unavailable, so this does not claim a fresh Alpine container build.

A separate read-only server check observed both existing containers running the
same image with zero restarts/OOM reports, worker readiness present, HTTP health
200, a reachable PostgreSQL database, and approximately 18.5 GiB free disk. Only
the existing collection snapshot table was present; the new country tables were
not deployed. The previous Audit Fix CI deployment stopped at its two regression
failures before Docker build/EC2 changes. The corrected local fixtures/generated
asset pass the combined test gate. No new application deployment was performed.

References: [Shopify Scopes API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/scopes-api),
[Storefront token creation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/storefrontAccessTokenCreate),
[Storefront API](https://shopify.dev/docs/api/storefront/latest).
