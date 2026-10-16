# Collection pin list order

SoBooster's Collections column orders its serialized collection-ID text ascending.
This is neither title A–Z nor numeric ID order: `[132643192893]` precedes
`[9202630684]`. The empty all-collections key comes first. Multi-collection IDs
retain their original sequence inside the serialized array.

Collection pinning now defaults to that order. Its header reverses the ID-text
direction; CSV order and both creation-date sorts remain available. Equal keys
retain an observed source tie position when available, then existing CSV/date
order. The source export alone cannot reconstruct an unexported tie position.
Selection and product order within every rule are unaffected. Search pinning
keeps its existing Search term A–Z default. Storefront rule precedence is unchanged.

`PinnedProductRule.collectionSortKey` and `collectionSortPosition` are nullable
display metadata. The import action retains the source ID key, including IDs of
partially unmatched targets. Collection exports include that key in Collections.
Legacy/title-only imports preserve existing metadata. For legacy/manual rules,
the loader can derive keys from unique, shop-scoped catalog title matches; it
does not guess ambiguous or missing IDs. Unresolved keys sort last. Metadata is
cleared when an editor changes target collections, preserved on product-only
edits, and copied when duplicating a rule.

Deploy backend/admin and the additive Prisma fields together. No theme update
or product sync is needed. Existing rules can receive verified source display
metadata without reimporting products, overwriting rule contents or changing
their creation dates. Backfills must match the shop, collection scope, saved
rule IDs, original names and product-ID sequence before updating only these two
metadata fields, and must verify other fields remain intact.
