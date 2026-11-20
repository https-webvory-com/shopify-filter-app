Product sync status and read-only reconciliation
================================================

The dashboard separates a full scan attempt from current stored products.
`productsProcessed` counts every scanned Shopify product, including excluded
draft, archived and unpublished products. It is not a count of database/index
writes. A scan can reach 100% before finalization succeeds. The current attempt
must have a verified completion timestamp before the dashboard labels it completed.
The last successful full sync can belong to an older attempt and is shown separately.

Database rows and Shopify's active/published count are displayed independently.
Their numerical difference does not identify missing products, and equal counts
do not establish equal IDs. Storefront eligibility is active plus Online Store
publication; market availability, stock and merchandising are additional shopper
predicates, not reasons to silently change these store-wide denominators.

This dashboard has no verified incremental-write/index-ack watermark. It says so
explicitly instead of using `Product.updatedAt`, which unrelated maintenance and
ranking writes can change. A recent full sync alone also does not prove freshness.
Displaying a real incremental freshness timestamp later requires an acknowledged
per-store product/index watermark and queue/lag evidence; no such value is invented
by this presentation change.

Before any repair or restart, obtain three complete read-only ID snapshots in the
same store, publication, product-status and market scope, close enough in time to
avoid interpreting ordinary catalog edits as missing data. The scope describes the
intended catalog contract in every source. Shopify determines the eligible IDs;
retain the complete database/index inventory for that store and scope rather than
pre-intersecting it with Shopify IDs, which would hide stale extras. If stored rows
lack publication metadata, classify extra IDs against current Shopify metadata
instead of assuming that every stored row is still published. Capture times are
retained in the report. Example input:

```json
{
  "shopify": {
    "scope": {"shop":"example.myshopify.com","publication":"online-store","status":"ACTIVE","market":null},
    "complete":true,"capturedAt":"2026-11-20T00:00:00Z","ids":["1","2"]
  },
  "database": {
    "scope": {"shop":"example.myshopify.com","publication":"online-store","status":"ACTIVE","market":null},
    "complete":true,"capturedAt":"2026-11-20T00:00:00Z","ids":["gid://shopify/Product/1","2"]
  },
  "index": {
    "scope": {"shop":"example.myshopify.com","publication":"online-store","status":"ACTIVE","market":null},
    "complete":true,"capturedAt":"2026-11-20T00:00:00Z","ids":["1","3"]
  }
}
```

Run `node scripts/reconcile-product-ids.mjs snapshots.json`. It reads only that
file, makes no service connections and reports unique ID counts, missing database
IDs, missing index IDs and extra IDs in each source. Shopify GIDs and numeric ID
strings compare equally. Incomplete or differently scoped snapshots are rejected.
It does not authorize, start, resume or repair a sync. No reconciliation is claimed
in the dashboard until actual complete production snapshots have been compared.
