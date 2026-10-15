# Shopify App Template - React Router

## Collection first-visit loading

Public collection rankings retain their last usable sequence through idle periods (up to one day, capped at 40 versions per shop). The dedicated worker discovers existing public warmup registries on startup and refreshes recent public collection contexts every four minutes. Configuration revisions still invalidate immediately. Filtered/customer-specific preparations keep their ten-minute retention; known product changes older than the existing freshness window require a rebuilt ranking. Existing tokens retain their own order. No Meilisearch index setting, product sort/comparator, pinning, price, or facet contract changes are required.

The collection request can start from the inline Liquid script while deferred assets load. The consumer reuses it only when the full normalized request URL matches (shop, collection, market, customer, sort, filters and pagination). Mismatches/changes abort it and use the normal request. Search pages retain the published first-load fix and never consume this collection prefetch. Background registry bookkeeping no longer blocks the product response.

This is not a guaranteed two-second load for a never-built collection, a new filter/market context, a required configuration/product rebuild, or an unavailable worker. Before this change, a measured Dress Outlet Formal Dresses reload showed cards at 5,008 ms and its API started at 2,182 ms; the decoded response was about 871 KB. Controlled local browser checks improved request overlap from 1,884 to 1,195 ms (synthetic delays, not live timing). Verify the real storefront after deploying backend **and worker**, then publishing the theme extension. No live speed improvement is claimed from local tests.

Verification: `node scripts/run-regression-tests.mjs`; `node tests/collection-loading/run-headless.mjs` (21 actual-assets/API browser scenarios using synthetic catalog and in-memory queue); `node tests/collection-loading/run-redis-regressions.mjs` (real Redis/BullMQ in a unique temporary namespace, using `TEST_REDIS_HOST` / `TEST_REDIS_PORT` if set); and `node --max-old-space-size=256 tests/collection-loading/run-memory-check.mjs tags` (also `variants`, `dense-variants`). The real Redis suite deletes only its random test-owned namespace. Reports are ignored under `scratch/collection-*`.

## Search banners

Search > Banners creates promotions for exact search queries (case, Unicode width and extra whitespace are normalized). Choose Top or Product grid, an HTTPS image URL, an optional store-relative/HTTPS link, alternative text, heading/content/button label and colors. Grid banners can use text without an image. Upload images separately through Shopify Content / Files and paste their image URLs. In-app file upload is not included.

Position 1 inserts a grid promotion before product 1. A banner beyond the result count stays hidden; banners do not replace products or change counts, ranking, facets or pagination. One banner is allowed per query/placement/position, including disabled campaigns. Edit, enable/disable and delete are shop-scoped. Top banners require an image. Empty searches do not trigger promotions; autocomplete and collection pages are unchanged.

Both our search grid and native Dawn-style `main #product-grid` can display promotions. Native later-page offsets are derived from a first-page theme HTML request. If the theme cannot supply a usable grid/page size, uncertain grid banners stay hidden; top campaigns and products stay available. API errors/timeouts and broken images do not block search. Other theme selectors and live SoBooster behavioral parity remain unverified.

Deploy the backend, generate Prisma and apply `20261014020000_search_banners` (or the existing deployment schema setup), then deploy the Shopify extension containing `searchBanners.js/css` and its Liquid includes. No live deployment was performed during implementation.

Validation: `npm run test:search-banners`, `npm run test:search-banners:database`, and `npm run test:search-banners:browser`. Database/browser runners generate a separate fixture Prisma client and start a fresh loopback-only PostgreSQL cluster under `scratch`, apply the real migrations, and stop the cluster afterward. `POSTGRES_BIN` and `HEADLESS_CHROME_PATH` override tool locations. Browser tests use real editor/service/API/banner assets with fixture Shopify authentication/catalog grids. Reports are ignored under `scratch/banner-headless-results.json`.

For connected-browser fallback, run `node tests/search-banners/prepare-client.mjs`, `node tests/search-redirect/start-postgres.mjs`, and `node tests/search-banners/serve-fixture.mjs`. Open the printed origin's `/test-runner` in an isolated browser context and run `window.runBannerChecks()`. Create `scratch/banner-fixture-stop-<pid>` using the PID in `scratch/banner-fixture.json` to stop the server, then run `node tests/search-redirect/stop-postgres.mjs`.

## Semantic search providers

OpenAI is the default semantic search provider. Set `OPENAI_API_KEY` in the server environment; do not commit keys. It uses `text-embedding-3-small` with 768 dimensions and a 50/50 keyword/semantic blend. No Gemini key is needed.

After deploying the provider-aware backend, run `npm run semantic:setup` on a server with access to Meilisearch. This provisions the selected provider and generates embeddings for the existing catalog. It removes the legacy `default` embedder and the inactive provider from the index, so indexing does not call Gemini while OpenAI is selected. `npm run semantic:status` checks configuration without printing keys. Verify the setup task succeeded before checking live relevance. Queries fall back to keyword search while the selected embedder is unavailable or a provider request fails.

Gemini setup remains in code. To switch later, set `SEMANTIC_EMBEDDING_PROVIDER=gemini` and `GEMINI_API_KEY`, deploy/restart, and rerun setup to rebuild vectors. OpenAI and Gemini use separate embedder names; their vectors are never reused across providers. Do not switch a live relay's provider without rerunning setup: old provider requests are rejected rather than mixing vector spaces.

Optional relay: set both `SEMANTIC_RELAY_URL` and `SEMANTIC_RELAY_TOKEN` on the app. The relay uses the selected provider's API key, authenticates requests, batches embeddings, and caches them separately by provider and credential. Without relay settings, Meilisearch calls the selected provider directly.

Ordinary catalog sync leaves embedding provisioning alone unless `SEMANTIC_EMBEDDING_SETUP_ENABLED=true` is explicitly set. Use the setup command for the initial migration; keep that flag unset afterward. `SEMANTIC_SEARCH_ENABLED=false` temporarily disables hybrid queries.

This is a template for building a [Shopify app](https://shopify.dev/docs/apps/getting-started) using [React Router](https://reactrouter.com/). It was forked from the [Shopify Remix app template](https://github.com/Shopify/shopify-app-template-remix) and converted to React Router.

Rather than cloning this repo, follow the [Quick Start steps](https://github.com/Shopify/shopify-app-template-react-router#quick-start).

Visit the [`shopify.dev` documentation](https://shopify.dev/docs/api/shopify-app-react-router) for more details on the React Router app package.

## Upgrading from Remix

If you have an existing Remix app that you want to upgrade to React Router, please follow the [upgrade guide](https://github.com/Shopify/shopify-app-template-react-router/wiki/Upgrading-from-Remix). Otherwise, please follow the quick start guide below.

## Quick start

### Prerequisites

Before you begin, you'll need to [download and install the Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) if you haven't already.

### Setup

```shell
shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router
```

### Local Development

```shell
shopify app dev
```

Press P to open the URL to your app. Once you click install, you can start development.

Local development is powered by [the Shopify CLI](https://shopify.dev/docs/apps/tools/cli). It logs into your account, connects to an app, provides environment variables, updates remote config, creates a tunnel and provides commands to generate extensions.

### Authenticating and querying data

To authenticate and query data you can use the `shopify` const that is exported from `/app/shopify.server.js`:

```js
export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 25) {
        nodes {
          title
          description
        }
      }
    }`);

  const {
    data: {
      products: { nodes },
    },
  } = await response.json();

  return nodes;
}
```

This template comes pre-configured with examples of:

1. Setting up your Shopify app in [/app/shopify.server.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/shopify.server.ts)
2. Querying data using Graphql. Please see: [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx).
3. Responding to webhooks. Please see [/app/routes/webhooks.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/webhooks.app.uninstalled.tsx).
4. Using metafields, metaobjects, and declarative custom data definitions. Please see [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx) and [shopify.app.toml](https://github.com/Shopify/shopify-app-template-react-router/blob/main/shopify.app.toml).

Please read the [documentation for @shopify/shopify-app-react-router](https://shopify.dev/docs/api/shopify-app-react-router) to see what other API's are available.

## Shopify Dev MCP

This template is configured with the Shopify Dev MCP. This instructs [Cursor](https://cursor.com/), [GitHub Copilot](https://github.com/features/copilot) and [Claude Code](https://claude.com/product/claude-code) and [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) to use the Shopify Dev MCP.

For more information on the Shopify Dev MCP please read [the documentation](https://shopify.dev/docs/apps/build/devmcp).

## Deployment

### Application Storage

This template uses [Prisma](https://www.prisma.io/) to store session data, by default using an [SQLite](https://www.sqlite.org/index.html) database.
The database is defined as a Prisma schema in `prisma/schema.prisma`.

This use of SQLite works in production if your app runs as a single instance.
The database that works best for you depends on the data your app needs and how it is queried.
Here’s a short list of databases providers that provide a free tier to get started:

| Database   | Type             | Hosters                                                                                                                                                                                                                                    |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MySQL      | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mysql), [Planet Scale](https://planetscale.com/), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/mysql) |
| PostgreSQL | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres)                                   |
| Redis      | Key-value        | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-redis), [Amazon MemoryDB](https://aws.amazon.com/memorydb/)                                                                                                        |
| MongoDB    | NoSQL / Document | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mongodb), [MongoDB Atlas](https://www.mongodb.com/atlas/database)                                                                                                  |

To use one of these, you can use a different [datasource provider](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#datasource) in your `schema.prisma` file, or a different [SessionStorage adapter package](https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/docs/guides/session-storage.md).

### Build

Build the app by running the command below with the package manager of your choice:

Using yarn:

```shell
yarn build
```

Using npm:

```shell
npm run build
```

Using pnpm:

```shell
pnpm run build
```

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/launch/deployment) to host it externally. From there, you have a few options:

- [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run): This tutorial is written specifically for this example repo, and is compatible with the extended steps included in the subsequent [**Build your app**](tutorial) in the **Getting started** docs. It is the most detailed tutorial for taking a React Router-based Shopify app and deploying it to production. It includes configuring permissions and secrets, setting up a production database, and even hosting your apps behind a load balancer across multiple regions.
- [Fly.io](https://fly.io/docs/js/shopify/): Leverages the Fly.io CLI to quickly launch Shopify apps to a single machine.
- [Render](https://render.com/docs/deploy-shopify-app): This tutorial guides you through using Docker to deploy and install apps on a Dev store.
- [Manual deployment guide](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service): This resource provides general guidance on the requirements of deployment including environment variables, secrets, and persistent data.

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.

## Gotchas / Troubleshooting

### Database tables don't exist

If you get an error like:

```
The table `main.Session` does not exist in the current database.
```

Create the database for Prisma. Run the `setup` script in `package.json` using `npm`, `yarn` or `pnpm`.

### Navigating/redirecting breaks an embedded app

Embedded apps must maintain the user session, which can be tricky inside an iFrame. To avoid issues:

1. Use `Link` from `react-router` or `@shopify/polaris`. Do not use `<a>`.
2. Use `redirect` returned from `authenticate.admin`. Do not use `redirect` from `react-router`
3. Use `useSubmit` from `react-router`.

This only applies if your app is embedded, which it will be by default.

### Webhooks: shop-specific webhook subscriptions aren't updated

If you are registering webhooks in the `afterAuth` hook, using `shopify.registerWebhooks`, you may find that your subscriptions aren't being updated.

Instead of using the `afterAuth` hook declare app-specific webhooks in the `shopify.app.toml` file. This approach is easier since Shopify will automatically sync changes every time you run `deploy` (e.g: `npm run deploy`). Please read these guides to understand more:

1. [app-specific vs shop-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions)
2. [Create a subscription tutorial](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started?deliveryMethod=https)

If you do need shop-specific webhooks, keep in mind that the package calls `afterAuth` in 2 scenarios:

- After installing the app
- When an access token expires

During normal development, the app won't need to re-authenticate most of the time, so shop-specific subscriptions aren't updated. To force your app to update the subscriptions, uninstall and reinstall the app. Revisiting the app will call the `afterAuth` hook.

### Webhooks: Admin created webhook failing HMAC validation

Webhooks subscriptions created in the [Shopify admin](https://help.shopify.com/en/manual/orders/notifications/webhooks) will fail HMAC validation. This is because the webhook payload is not signed with your app's secret key.

The recommended solution is to use [app-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions) defined in your toml file instead. Test your webhooks by triggering events manually in the Shopify admin(e.g. Updating the product title to trigger a `PRODUCTS_UPDATE`).

### Webhooks: Admin object undefined on webhook events triggered by the CLI

When you trigger a webhook event using the Shopify CLI, the `admin` object will be `undefined`. This is because the CLI triggers an event with a valid, but non-existent, shop. The `admin` object is only available when the webhook is triggered by a shop that has installed the app. This is expected.

Webhooks triggered by the CLI are intended for initial experimentation testing of your webhook configuration. For more information on how to test your webhooks, see the [Shopify CLI documentation](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger).

### Incorrect GraphQL Hints

By default the [graphql.vscode-graphql](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql) extension for will assume that GraphQL queries or mutations are for the [Shopify Admin API](https://shopify.dev/docs/api/admin). This is a sensible default, but it may not be true if:

1. You use another Shopify API such as the storefront API.
2. You use a third party GraphQL API.

If so, please update [.graphqlrc.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/.graphqlrc.ts).

### Using Defer & await for streaming responses

By default the CLI uses a cloudflare tunnel. Unfortunately cloudflare tunnels wait for the Response stream to finish, then sends one chunk. This will not affect production.

To test [streaming using await](https://reactrouter.com/api/components/Await#await) during local development we recommend [localhost based development](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options#localhost-based-development).

### "nbf" claim timestamp check failed

This is because a JWT token is expired. If you are consistently getting this error, it could be that the clock on your machine is not in sync with the server. To fix this ensure you have enabled "Set time and date automatically" in the "Date and Time" settings on your computer.

### Using MongoDB and Prisma

If you choose to use MongoDB with Prisma, there are some gotchas in Prisma's MongoDB support to be aware of. Please see the [Prisma SessionStorage README](https://www.npmjs.com/package/@shopify/shopify-app-session-storage-prisma#mongodb).

### Unable to require(`C:\...\query_engine-windows.dll.node`).

Unable to require(`C:\...\query_engine-windows.dll.node`).
The Prisma engines do not seem to be compatible with your system.

query_engine-windows.dll.node is not a valid Win32 application.

**Fix:** Set the environment variable:

```shell
PRISMA_CLIENT_ENGINE_TYPE=binary
```

This forces Prisma to use the binary engine mode, which runs the query engine as a separate process and can work via emulation on Windows ARM64.

## Collection ranking preparation and loading

Non-manual collection rankings are prepared on the `collectionRankingQueueV2` by
the dedicated background process. A missing current ranking returns HTTP 202;
the storefront polls with cancellation and a bounded retry limit. It does not
render fallback ordering. Cached pages keep Shopify Best selling ordering,
merchandising, pins, exclusions, zero-price grouping and immutable pagination
sessions. The existing individual document reads remain in place; no new `id`
filter or index-settings migration is required.

Rule and pin mutations advance the shop ranking revision and invalidate prepared
rankings. An older in-flight build cannot publish after that revision changes.
Existing browsing tokens retain their sequence for up to an hour; new sessions
use the new revision. Shopify collection changes remain asynchronous through
webhooks and snapshot refreshes. Shopify manual drag-and-drop sorting is unchanged.

Cache deletion is restricted to owned cache prefixes; BullMQ hashes, locks and
queue sets are never deleted by shop invalidation. Revisioned configuration
cache keys also prevent late writes from another process restoring old settings.
The V2 queue and prepared-cache namespace bypass damaged jobs from the earlier
implementation without purging its queue.

Product webhooks wait for indexing before comparing the indexed documents.
Unchanged documents skip invalidation. Changed documents advance data revisions
only for affected collections (plus the shared product-data caches), rather than
advancing the strict rule/pin revision. A usable prepared sequence remains available
while its product data refreshes. Updates during a cold build permit that build
to publish and schedule a follow-up refresh; they cannot repeatedly discard it.
This means product-driven ranking and eligibility changes are eventual during
refresh; it does not promise instant product-update visibility. Rule/pin saves
still reject the old configuration for new sessions.

The app remembers up to 20 anonymous unfiltered collection contexts per shop for
one day and warms them after invalidation or changed Shopify order. Customer tags
and filtered URLs are not replayed as anonymous requests. Active visitor jobs
have priority over background warmups. Valid prepared rankings have a ten-minute
TTL and can refresh in the background during their last two minutes. A truly cold
collection still needs preparation; worker backlog or unavailable services can
require Retry. Skeletons display immediately, and longer waits show a loading
message. Images and verified market prices update independently after cards render.

Deploy both the backend/worker image and the Shopify theme-extension JS/CSS.
Worker readiness and shutdown include the ranking worker. Backend pending
responses also retain the older extension's readiness signal for compatibility.
The Docker workflow does not publish Shopify theme-extension assets.

The deployment workflow runs regressions and memory checks on Node 20 before
publishing an image. If replacement app or worker startup fails, it attempts to
restore their previous image IDs and reports deployment failure. After both
startup checks pass, unused-image cleanup cannot trigger a rollback.

Ranking retains one batch of full product data and sorts compact records using
the shared merchandising comparator. Tag-only preparation scans 1000 products
per request; variant-dependent rules use 25 to bound memory. Both paths scan
sequentially. These smaller variant batches add requests, so large-catalog cold
latency still needs measurement after deployment.

Selected maximum prices are sent independently of changing facet maxima, so
choosing another filter cannot silently remove an explicit price cap.

Local verification commands:

```powershell
node scripts/run-regression-tests.mjs
node tests/collection-loading/run-redis-regressions.mjs
node tests/collection-loading/run-headless.mjs --real-redis
node --max-old-space-size=256 tests/collection-loading/run-memory-check.mjs tags
node --max-old-space-size=256 tests/collection-loading/run-memory-check.mjs variants
node --max-old-space-size=256 tests/collection-loading/run-memory-check.mjs dense-variants
npm.cmd run build
```

Redis checks use a unique temporary namespace and remove only their own keys.
Set `TEST_REDIS_HOST` and `TEST_REDIS_PORT` to use a test Redis service; the default
is the existing app Redis endpoint. Headless checks use installed Chrome,
unmodified storefront assets, the actual API loader/ranking code and real
Redis/BullMQ. Catalog, index, settings and session data are fixtures. Passing these
checks verifies queue behavior and browser flows, not live store latency or parity.

## Resources

React Router:

- [React Router docs](https://reactrouter.com/home)

Shopify:

- [Intro to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify App Bridge](https://shopify.dev/docs/api/app-bridge-library).
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components).
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)

Internationalization:

- [Internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)

## Search page redirects

Search > Page Redirects supports multiple queries per rule (one per line), a store-relative path or HTTPS destination, and create/edit/enable/disable/delete actions. Matching is exact after Unicode normalization, trimming, whitespace collapsing and lowercasing. Each query belongs to one rule per shop, including disabled rules. Conflicting edits roll back atomically. Search-page destinations and unsafe URL schemes are rejected.

Redirects run on a submitted `/search?q=...` page, including locale-prefixed search paths, when either the AI Instant Search app embed or the Collection Filter Pro search-page block is installed. The embed also supports Shopify's native search page without the filter block. Both share one lookup when installed together. They do not navigate during autocomplete typing or affect collection browsing. The redirect lookup has a 1.5-second timeout and falls back to ordinary search on failure. Rules are read fresh rather than cached.

Deploy the new `SearchRedirect` and `SearchRedirectQuery` tables with the backend, regenerate Prisma Client, and deploy the theme extension. This repository's existing container setup uses `prisma db push`; migration-based environments can apply `20261014000000_search_redirects`. A Shopify extension-only deployment does not deploy the editor, API or database schema.

Run `npm run test:search-redirects` for unit, action/API and storefront fallback checks. Run `npm run test:search-redirects:browser` for real PostgreSQL persistence and browser checks. The latter requires PostgreSQL binaries (Windows default: `C:/Program Files/PostgreSQL/18/bin`; override with `POSTGRES_BIN`) and Chrome (`HEADLESS_CHROME_PATH` overrides its path). It creates a separate loopback-only database cluster under ignored `scratch`, applies the new migration, and stops the cluster afterward. Browser fixtures use the actual redirect editor, service, API and storefront code, with fixture Shopify authentication and catalog responses; they do not test live Shopify authentication or a deployed store.

## Blacklist Suggestions

Search > Blacklist Suggestions supports create/edit/enable/disable/delete for autocomplete suppression rules. Contains performs literal substring matching; Exact match compares the complete suggestion phrase. Both normalize Unicode, case and whitespace. Each store owns its rules, and duplicate term/operator combinations are rejected. The same term may have separate Contains and Exact rules.

Rules filter generated suggestions before the suggestion limit is applied. Product results, pinning, merchandising, redirects, collection filtering and personal recent-search history are not changed. Enabled rules are read fresh on each typed search. The `/api/search` response uses `Cache-Control: no-store` so browser/CDN caching cannot retain an outdated suggestion policy; the existing storefront session cache still renders product cards while refreshing search data. A blacklist database failure hides suggestions while keeping product results available.

Deploy the backend and apply the `SearchSuggestionBlacklist` schema, regenerating Prisma Client. The container's existing setup uses `prisma db push`; migration-based environments can apply `20261014010000_suggestion_blacklist`. This feature does not change theme extension assets and does not require a new Shopify extension version.

Run `npm run test:suggestion-blacklist` for matching, CRUD, validation, tenant isolation and actual search API regression checks. `npm run test:suggestion-blacklist:browser` adds real PostgreSQL and headless browser fixtures using the same prerequisites as redirect browser checks. Headless Chrome can fail at startup under managed Windows tokens; in that environment use `node tests/search-redirect/start-postgres.mjs` and `node tests/suggestion-blacklist/serve-fixture.mjs` to open the printed loopback fixture URL in an isolated browser context. The fixture's `/admin-ui` and `/store` views use actual local code, a synthetic catalog, mocked Shopify authentication, and a fresh local database. Request fixture shutdown by writing `scratch/blacklist-fixture-stop-<pid>` using the PID in `scratch/blacklist-fixture.json`, then run `node tests/search-redirect/stop-postgres.mjs`.

## Search pinning and merchandising checks

`npm run test:search-pinning` checks shared search ranking, scopes, pin eligibility, full-page pagination, sorting, and the authenticated product picker. Search pinning follows the target-term product list, saved pin order, individual/group dragging, and independent instant/page controls described at https://docs.sobooster.com/guide/merchandising/search/pinning.

For an isolated browser fixture, run `npm run test:search-pinning:fixture`, open its printed loopback URL at `/admin-ui` in a fresh browser context, then evaluate `tests/search-pinning/browser-checks.js` and call `await runPinningChecks()`. This renders the actual editor and executes the real search/pinning services against an in-memory catalog and mocked Shopify authentication. It never uses production data. Stop it by creating `scratch/pinning-fixture-stop-<pid>` using the PID in `scratch/pinning-fixture.json`.

Backend and theme extension changes require deployment before live verification. Full-page ranking requires the app's Search & Collection Filter widget; the instant-search embed alone does not replace Shopify's native search grid. Large-catalog cold-search latency and full live SoBooster parity remain unverified.
## Search Settings (fourth upcoming search feature)

Search > Search Settings now saves shop-specific settings for this app's instant search and search results widget. Supported controls: enable instant search; instant products (1–20); typed suggestions (0–10); collection suggestions (0–10); recent searches (0–10); minimum characters (1–5); up to 10 ordered manual suggestions; results per page (1–40); and results-page search input, vendor, sale and sold-out label visibility. Manual suggestions replace recent history on empty input, are escaped as text, and respect the suggestion blacklist. Existing theme badge position/visibility rules still apply. Collection templates keep their existing settings.

Deploy the backend with the new `SearchSetting` table (`prisma/migrations/20261015010000_search_settings/migration.sql`) and regenerate Prisma, then publish the theme extension containing `searchSettings.js` and the updated consumers. Existing startup `npm run setup` synchronizes the schema. No-row/defaults and a failed/timed-out public settings lookup preserve legacy/theme defaults. Lookup is shared per document, uncached, and bounded to 1.5 seconds; changed settings apply on the next page load. Restoring defaults deletes only that shop's override. No product indexing, collection preparation, ranking, or cache invalidation is performed by settings saves.

This release does not include SoBooster's full layout editor, alternate pagination modes, custom result URL, broad matching, page suggestions, metafield projection, or price units. Native Shopify search grids do not consume these result controls; use this app's search results widget. SoBooster remains unchanged.

Local verification:

- `npm run test:search-settings` validates bounds/types, authentication, tenant isolation, persistence logic, blacklist/failure handling, optional bootstrap, escaped manual/history content, and disabled instant search.
- `npm run test:search-settings:database` generates an isolated Prisma client and starts a scratch PostgreSQL instance, applies the actual migration, checks CRUD/isolation and a real missing-table fallback, and stops the instance. Requires local PostgreSQL (default `C:/Program Files/PostgreSQL/18/bin`, configurable via `POSTGRES_BIN`).
- For browser checks, run `node tests/search-banners/prepare-client.mjs`, `node tests/search-redirect/start-postgres.mjs`, `node tests/search-settings/check-postgres.mjs`, then `npm run test:search-settings:fixture`. Open the printed local origin `/test-runner` in an isolated browser context and execute `await window.runSettingsChecks()`. Twelve checks exercise the actual React editor, API, service and storefront assets against isolated PostgreSQL, with synthetic theme/catalog and mocked Shopify authentication. Stop via `scratch/settings-fixture-stop-<pid>` (pid in `scratch/settings-fixture.json`), then `node tests/search-redirect/stop-postgres.mjs`. Physical phones and deployed Shopify behavior require the planned live test.

The four formerly upcoming search features are Page Redirects, Blacklist Suggestions, Search Banners, and Search Settings. After deployment, verify each on the authorized store and both search surfaces as applicable, including redirect precedence, blacklist/manual terms, banner positions with nondefault page sizes, empty results, pagination, pinning/merchandising, and collection isolation.
