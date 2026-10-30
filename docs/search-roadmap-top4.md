# Search roadmap: first four work items

Released from commit `b0e8f64` on 2026-10-30. EC2 workflow `41011321613` passed, and Shopify app version `ai-smart-search-filter-439` was released. Live search speed and merchant-specific behavior still need measurement.

## 1. Faster search response and shared caching

- Anonymous search-page Meilisearch batches use a 60-second Redis cache scoped by shop, country, locale, and query/filter payload. Product and search revisions invalidate that cache when known catalog or rule changes occur.
- Public responses advertise a 60-second shared cache policy. Customer-specific requests use `no-store`. This accepts up to 60 seconds of stale stock or rules when no invalidation signal arrives.
- Search cards no longer wait for a synchronous Shopify Admin market-pricing request. The storefront shows cards first and verifies market prices independently after render.
- This reduces blocking work; it does not guarantee a 1–2 second result on a cold query or a slow origin.

## 2. Shopify bulk product indexing and catalog drift

- Admin can start a fresh Shopify Bulk Operations product sync. The worker polls the operation, streams grouped JSONL one product at a time, writes the existing PostgreSQL and Meilisearch representations, and checkpoints only after index tasks and membership checks succeed. A failed bulk job can resume from its last checkpoint.
- The completion step compares Shopify's exported active, Online Store published products with both the database and serving index, repairs small differences, and refuses to mark a divergent job complete.
- A daily audit runs for connected shops. It uses a separate Shopify bulk identity export, compares the database and serving index, repairs up to 250 affected product IDs, and schedules a full bulk sync for larger drift. Audit state and counts are saved in Redis.
- The worker must be running for either path. The bulk sync is triggered from the authenticated admin; daily audits begin after deployment. The release itself did not click the manual bulk sync button.

## 3. Facet and size normalization

- Common apparel size spellings such as `XXL`, `2X`, and `2XL` resolve to a canonical `2XL` label. Merchant-defined merges take precedence. Numeric dress sizes remain distinct.
- The same alias expansion is used for same-variant filtering. When raw facet values merge, the API obtains an exact union count instead of adding counts that might double-count a product. If that count cannot be obtained, raw labels stay separate.
- Vendor, product type, tag, title, option, and metafield merge counts use the same exact-count path.

## 4. Per-store search settings

- Restored and adapted the deferred per-shop search-index implementation from the local archive. Admin settings cover searchable fields and weights, transforms, stopwords, delimiters, SKU handling, selected metafields, result URL, price unit, and instant-search layout/columns.
- A separate versioned Meilisearch index is built per store. The active index switches only after the replacement is ready; product updates and deletes are forwarded to it. Search and collection-search requests use the selected index and configured query behavior, including typo tolerance, AND-first matching, and junk-query handling.
- Live index readiness, Shopify operation limits, merchant-specific relevance, and actual speed still require store checks. A custom index is built after a store saves settings that require one.

## Verification

- Full Node 20 regression suite, React Router production build, Shopify extension build, and built web/worker startup checks are the local release gates. Local tests cover bulk parsing/checkpoints, drift eligibility, normalized counts, cache privacy, and configured search behavior.
- Deployment is complete; the app health endpoint returned HTTP 200. A passing health check does not measure search latency.
