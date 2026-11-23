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

The existing price updater patches price, compare-at/sale information and related
variant details inside existing cards. Card and image elements stay in place during
an SSE update. Live prices override older collection snapshots for the lifetime of
the page, until a newer update replaces them. Failures retain the displayed price
and retry; they do not substitute another country's price.

Prices update after webhook processing, rather than instantly at merchant Save.
This feature does not change the existing background refresh unit: a product
update still reads all its variants and configured country prices. It adds no
catalog resync or index build to shopper requests.

Live updates preserve the shopper's current ordering and loaded cards. A
"Prices updated. Refresh results" action requests the existing canonical collection
flow, clears its old ranking token and browser snapshots, and restarts at page one.
This lets the shopper refresh sort order and price/sale filter membership; SSE does
not itself recompute ranking or silently move/remove products. The existing
background collection preparation still determines when replacement results are
available. Events apply to displayed products; products newly entering a price
band require refreshing results.

Deployment requires matching backend and theme-extension assets, shared Redis
connectivity between web and worker processes, and a proxy that supports streaming.
The endpoint sends `text/event-stream`, `Cache-Control: no-cache, no-transform`
and `X-Accel-Buffering: no`. Production proxy behavior and end-to-end webhook
delivery require separate live verification after deployment. No deployment is
performed by the local tests.

Validation:

- `node --test tests/search/price-events.test.mjs tests/search/market-pricing.test.mjs tests/webhooks/worker.test.mjs`
- `node scratch/verify-price-events-browser-20261123.mjs` runs the actual Collection
  Filter Pro renderer, SSE route and saved-price route locally with fake Redis and
  database services; all external browser requests are blocked.
- Standard production build, full regression suite, and built web/worker startup
  checks run in `scratch/price-events-release-20261123` with logs in `scratch`.
