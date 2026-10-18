# Product collection membership repair

Both full sync and individual product sync must finish the nested collection
connection before saving the product. The initial 250 relationships are not the
complete list when `hasNextPage` is true. A failed later page must abort the save.

`scripts/repair-product-memberships.mjs` is a targeted, resumable membership-only
repair for existing active, published products with existing indexed documents.
Run in the application server environment after deploying the pagination fix.
It requires a JSON array of numeric product IDs or Shopify Product GIDs and an
explicit shop. Review the read-only output before applying:

```sh
node scripts/repair-product-memberships.mjs --shop thedressoutlet.myshopify.com --ids /tmp/product-ids.json
node scripts/repair-product-memberships.mjs --shop thedressoutlet.myshopify.com --ids /tmp/product-ids.json --apply
```

The script fetches every current Shopify membership page, reconciles DB links,
and partially updates only index membership fields and their search projection.
It preserves other product data and all merchant rules. Index failures stop the
run; rerunning reconciles differences between the DB and index. Applied runs
invalidate the shop's prepared rankings, including after a partial failure.
It does not start workers, create a full catalog sync, or contact SoBooster.
Coordinate repair with other catalog updates; DB and index writes are not one
cross-system transaction. Products removed/unpublished during the repair require
the normal product lifecycle sync instead.

Pin eligibility is outside this repair. Imported collection pins now require
membership or a matching Include rule; legacy/manual pin rules retain their
existing behavior. See [collection membership integrity](collection-membership-integrity.md)
for verification and rolling reconciliation safeguards.

Deploying this code does not automatically run a production membership repair.
Matching Shopify membership
does not guarantee identical SoBooster totals: stock freshness and five source
omissions were separate findings in the Cocktail audit.
