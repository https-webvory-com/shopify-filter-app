# Collection live prices

Collection Filter Pro subscribes to `/api/price-events` using native EventSource.
Notifications are published through Redis after a product webhook has successfully
updated the database, completed primary search indexing, and invalidated affected
caches. The original price fingerprint survives webhook retries. Notifications
contain product IDs, never prices or credentials.

Each collection tab opens one stream scoped to its shop, country, currency and up
to 500 rendered products. Load more extends that subscription; a new result set
replaces it. A web process shares one Redis subscriber across streams, with a
500-client limit. Connections have 20-second heartbeats and a five-minute lifetime;
EventSource reconnects after three seconds. Abort, cancellation, page exit and
hidden tabs release subscriptions. Hidden tabs catch up when visible again.

On a notification the browser reads only affected displayed products through the
existing `/api/market-prices` endpoint, in batches of at most 40 IDs. Duplicate
notifications are coalesced. Initial connection and reconnection re-read subscribed
products to cover missed events; Redis Pub/Sub is not a replay log. If complete
saved country prices are missing, the existing Shopify storefront product fallback
reads that browser's market, with at most eight concurrent requests. Responses from
an earlier country or obsolete rendering cannot patch current cards.

Each load also requests server verification with `POST /api/market-prices` for
the loaded product IDs and current country/currency. Existing dataset prices stay
visible while the durable product jobs run. The POST accepts no price amounts.
Supported markets are checked against Shopify; simultaneous shoppers share
in-flight jobs. A new load can check again after a job completes. Visible tabs
request another verification every minute, covering changes without a webhook.
SSE completion reads do not enqueue the same verification again.

The worker fetches that product's complete variant prices for the requested
country from authenticated Shopify Admin API queries. Complete, currency-matching
responses are required before an atomic country-only database update. Base prices
and other countries remain intact. It then patches the shared index, updates
serving configured-search projections, invalidates affected result data, and only
then publishes SSE. Unchanged prices cause no writes, invalidation or event.
A durable checkpoint repairs index/cache completion if a failure occurs after
the database commit. Product webhooks and country refreshes share a renewable
product lock; a changed database snapshot causes a retry rather than an overwrite.

The existing price updater patches price, compare-at/sale information and related
variant details inside existing cards. Card and image elements stay in place during
an SSE update. Live prices override older collection snapshots for the lifetime of
the page, until a newer update replaces them. Failures retain the displayed price
and retry; they do not substitute another country's price.

Prices update after background processing, rather than instantly at merchant Save.
A product webhook still reads all its variants and configured country prices;
load-triggered verification reads only the requested product and country. Shopper
requests enqueue bounded price checks, never a full catalog resync or index build.
This is not a country-wide freshness audit: off-page products still depend on
webhooks or subsequent checks. Unvisited markets require their own reconciliation
for market-wide changes that produce no product notification.

Live updates silently patch displayed prices while preserving the shopper's
current ordering, loaded cards and scroll position. No price-update notice or
refresh button is inserted above the collection cards. SSE does not itself
recompute ranking or move/remove products. Subsequent collection requests use
the existing result flow and background preparation; live card updates alone
do not refresh price/sale filter membership or add newly eligible products.

Deployment requires matching backend and theme-extension assets, shared Redis
connectivity between web and worker processes, and a proxy that supports streaming.
The endpoint sends `text/event-stream`, `Cache-Control: no-cache, no-transform`
and `X-Accel-Buffering: no`. Production proxy behavior and end-to-end webhook
delivery require separate live verification after deployment. No deployment is
performed by the local tests.

Validation:

- `node --test tests/search/price-events.test.mjs tests/search/market-price-refresh*.test.mjs tests/webhooks/worker.test.mjs`
- `node scratch/verify-country-price-db-sse-browser-20261123.mjs` exercises the
  actual renderer, POST action, refresh coordinator and SSE frames with fixture
  infrastructure; all external browser requests are blocked.
- `node scratch/verify-market-price-postgres-20261123.mjs` checks the actual
  Prisma/JSONB transaction, SQL sort/band results, tenant isolation and rollback
  against an isolated local PostgreSQL instance, stopped afterward.
- Production build, full regressions and built web/worker startup are checked by
  `node scratch/check-country-price-db-20261123.mjs`, with logs in `scratch`.
