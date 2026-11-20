UK configuration review — no activation or migration
====================================================

Scope: `thedressoutletuk.myshopify.com`. The merchant requested **review-only
mappings** on 2026-11-20. Existing synonyms (including test terms), merges,
disabled groups, assignments, connections and integrations must remain unchanged.
No catalog sync, resync, synonym activation, index build or country preparation
may be started as part of this review.

The adjacent JSON records the UK configuration available in a historical public
Prom collection response. It is a partial, dated observation, not a current admin
export: only active merges and that page's resolved filters are represented.
Disabled rules, all groups, default-group identity and current synonyms require
an authenticated, read-only UK export before a migration can be reviewed. The
reported SB counts are comparison evidence, not target counts or approved values.

Review each synonym as explicit directed pairs. This editor currently creates
both directions; it cannot safely import one-way mappings. Check capitalization,
leading/trailing and internal whitespace, multiword terms and exact product IDs.
For every proposed equivalent, record expected relevant products and counterexamples
that must remain excluded. No synonym candidates are invented or deleted here.

For each merge, review its exact filter source/type/key, target, every raw value,
enabled state and assigned groups. A representative published UK product and
variant must establish the expected choice. Check colour, size, stock and price
on the same variant. Keep distinct colours separate unless explicitly approved.
For every group, record enabled/default state and search/collection assignments;
verify that a disabled assignment is ignored and the enabled default is selected.
Do not enable the reported Main Filter merely because it is assigned Search Page.

Country availability already has a supported read-only Storefront permission
flow. Connection writes schedule country discovery/preparation, so it has NOT
been run. Before separate activation, review enabled Shopify countries and
`unauthenticated_read_product_listings`, expected eligible/ineligible products,
and coverage of collection, full search, instant search, quick-view and pagination.
Connection, prepared country data, market eligibility and currency display must
be recorded separately. A currency change alone does not establish eligibility;
blocked products must not be reintroduced by pins, merchandising or cached pages.
Missing or preparing data must be distinguishable from an eligible empty result.
Existing local market-availability tests cover enabled/disabled connections,
country snapshots and market-scoped filtering; they do not certify this UK store
as connected or all production surfaces as covered.

The Integrations page currently configures only Wishlist Growth. Its boolean
setting does not establish installation/health. Ratings/currency/translation
adapters must not be advertised as available until implemented and verified.
Wishlist functionality remains excluded from testing at the merchant's request.
No adapters or marketplace integrations are installed by this work.

Acceptance requires merchant-approved mappings, same-scope exports and product
fixtures. Keep a before/after mapping and a rollback copy. Only after explicit
approval may a separate change apply mappings or connect markets; normal runtime
activation must then be observed without triggering a full catalog resync.
