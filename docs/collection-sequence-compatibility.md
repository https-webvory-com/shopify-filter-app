# Collection sequence compatibility

Collection rules and pins must resolve to Shopify collection IDs. Titles remain
display labels; two collections named “New Arrivals” must not share targets.

Imported merchandising rules store their target IDs in `collectionIds`. Pinning
rules already preserve them in `collectionSortKey`. Legacy rules without IDs keep
their previous title matching. The editor and collection CSV importer preserve
existing bindings and reject ambiguous new title-only targets. Dropdown discovery
reads every collection page and falls back to the shop-owned catalog if a later
Shopify page fails.

For ID-bound tag-Set rules with saved numeric ordinals and verified 99/100/1000
patterns, matching Sets execute in saved order. A later Set replaces the score;
it does not create an independent permanent ranking tier. For example, matching
BestFormal can set 1,000, then a later matching BestProm sets 100. Tag pins refine
the supported ordinary 99/100 ladder, without jumping stronger scores or allowing
unscored products to bypass that ladder. Other arithmetic, legacy/unpositioned
rules, explicit pins, manual sorting and customer sort overrides retain their
existing behavior. Search rule priority is unchanged.

Unfiltered collection Include conditions expand the membership clause while
retaining shop, active status and availability constraints. Customer filters keep
their existing behavior. The classic sold-out exclusion uses known purchasability
instead of an inventory sum that can cancel positive variant stock. Other numeric
inventory ranges and search exclusions retain their existing semantics. The compact
ranking projection includes availability and the sequential-score flag. Ranking version 3 invalidates old prepared
collection sequences; existing frozen paging sessions keep their original sequence.

## Data repair

The schema migration only adds the `MerchandisingRule.collectionIds` array.
`scripts/repair-collection-identities.mjs` creates a plan from captured source rules,
our corresponding rule snapshot, and the canonical Shopify collection inventory.
The plan contains target bindings and missing, confirmed-published collection metadata
only. Unpublished or unverified collections are not created. It does not
edit scores, conditions, pin lists, products, variants or Shopify memberships.

The CLI defaults to a read-only dry run. Applying requires an explicit `--apply`, a
matching `--shop`, and a new backup file. It checks rule fingerprints, rejects foreign
ownership and conflicting bindings, uses a serializable transaction, and invalidates
only the shop's configuration caches after commit. A concurrent edit aborts the repair.
Apply the additive schema change before executing a write plan.

```
node --env-file=.env scripts/repair-collection-identities.mjs --plan PLAN.json --shop STORE.myshopify.com
node --env-file=.env scripts/repair-collection-identities.mjs --plan PLAN.json --shop STORE.myshopify.com --apply --backup BACKUP.json
```

The October 18 audit found 869 total collections, including 775 published collections.
The proposed plan binds 110 existing rules and creates 31 missing published collection
records; 24 missing unpublished records are left alone. Local replay covers the full
inventory and checks rule sets and unambiguous pin selection for represented collections.
All 775 published collections are represented after the proposed repair.
Unsupported legacy rule group order
is preserved; displayed source list order is not assumed to prove rank priority.
This is a local replay with
proposed metadata, not proof of deployed card positions or restored product membership.

## Verification limits

The vendor's equal-score ordering has not been established. Formal cards 27–28 tie
at 1,000; no product-specific weight or hardcoded order is added. Missing products,
missing memberships and products absent from the source index require separate
eligibility checks. Do not remove active products merely to force equal counts.
Multiple pin lists for one collection are not reordered based on guessed timestamp
priority. Live checks distinguish 14 winning lists among 18 overlapping contexts;
existing selection agrees in those 14. Four other contexts do not identify a unique
winner. Actual patched score-priority replay covers 1,933 observed products in 11
contexts with zero priority mismatches, while holding source order within tied scores
and excluding explicit pins. This does not establish Shopify/native tie order.
Four browser checks exercise actual modal ID persistence and duplicate
titles; unit tests cover matching, ordering, eligibility, imports and guarded repairs.
Production parity still requires deployment, the guarded repair, and complete fresh
sequence checks after resolving product-data differences. No SoBooster write is needed.
