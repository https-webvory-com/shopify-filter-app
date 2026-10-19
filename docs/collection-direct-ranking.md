# Collection ranking inputs and first visits

Collection requests can now build a frozen ranking from compact product fields and maintained variant-rule matches, without waiting behind the ranking worker. Only the visible page subsequently reads full product documents. Ranking still sorts the complete compact candidate set; this change does not implement a native search-engine top-25 ranking query.

Variant-rule matches use the existing matcher, including merged option values and merchandising images. Existing scoring, explicit pins, eligibility, Shopify best-selling order, zero-price handling and browsing tokens remain authoritative. Product index writes publish versioned matches to Redis first, then add the corresponding input hash to the index document. Reads require that exact version. Background backfill reads existing documents and writes only Redis facts, never product/index records.

The periodic ranking scheduler discovers the configured shop's rules and fills missing facts in background priority-10 pages of 100 headers, reading full documents in batches of 25. Catalog preparation and recent warmups share that priority to avoid starving unseen collections. Visitor jobs retain priority 1. Failed page jobs can be retried by a later sweep. Two profile generations and two input versions per product are retained; each profile has a 64 MiB encoded-value budget, a 16 KiB record limit and a 24-hour TTL. Redis allocator and hash overhead are additional.

The direct path is restricted to anonymous public contexts, supported scalar/variant rules, and the existing supported sorts. Best-selling still requires a complete Shopify order snapshot. Unknown conditions, missing facts, unavailable Redis, a configuration race or a four-second direct-read budget fall back to the existing queue. One distinct direct build runs per web process; simultaneous requests for the same context share it. Different concurrent contexts can still take the queued path. Browser polling timeouts are unchanged.

## Rollout and rollback

Default scope is shops listed in `app/config/collection-prewarm.json`. Set `CFP_COLLECTION_DIRECT_SHOPS` to a comma-separated explicit allowlist to narrow or override that scope. Set `CFP_COLLECTION_DIRECT_RANKING=false` on web and worker to disable direct reads and fact maintenance. Existing cached fields become inert; no schema or search-index settings migration is needed.

After deploying both web and worker, allow the initial fact sweep to finish. Check `direct-ready` versus `direct-unavailable` preparation events. Then measure separate fresh browser contexts on Bodycon, Burgundy, Fall and a large collection; compare complete API IDs/metadata and pagination with the existing ranker. Initial missing facts can still use the slower path. This local implementation has not established a live under-four-second card-render result or recovered SoBooster's private backend design.

## Local validation

- 588/588 regression tests and production build passed; final service/warmup checks passed after bounding bulk fact writes and isolating optional scheduler failures.
- 12,025-product full ranking/metadata parity across variants, merged colors, pins, exclusions and custom sorts.
- Real Redis source-version isolation, corruption rejection, profile retention and tenant isolation in a temporary namespace.
- `node --max-old-space-size=256 tests/collection-loading/run-memory-check.mjs facts`: 80,262 compact candidates, observed heap 106 MiB, 627 ms in the local synthetic fixture.
- 10/10 real Redis/BullMQ queue/cache regressions passed, including worker crash recovery and retention.
- 24/24 actual storefront assets/API browser fixture checks passed, including a paused ranking worker, loading, failures and pagination. Fixture timings are not live storefront benchmarks. Evidence: `scratch/collection-headless-results.json`, `scratch/collection-redis-results.json`, `scratch/collection-memory-facts.json`, and `scratch/petite-loading-optimization/{tests,build}.log`.
