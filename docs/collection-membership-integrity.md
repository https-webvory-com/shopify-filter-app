# Collection membership integrity

Imported collection pin lists with Include rules (identified by their saved collection ID targets)
position products that are already members or match a collection Include rule.
They do not grant membership. Exact tags remain distinct. Legacy/manual pin rules
and search behavior retain their existing contract. Collections without Include
rules retain explicit outside-collection pins, as observed in live Cocktail.
New preparation identities
invalidate older rankings; existing paging sessions remain frozen until reloaded.

Full sync verifies each active product's complete DB membership and its intended
index membership after the index task succeeds and before advancing the cursor.
Strict single-product sync uses the same verification. A failure leaves the
checkpoint unadvanced and is retried by the existing durable queue.

A separate single-concurrency membership worker checks one published collection
per scheduled turn. The scheduler runs once a minute, deduplicates active work,
and defers during a full product sync. Published catalog discovery is paginated
and cached for an hour. Its rolling cursor advances only after verification.
Actual cycle time depends on collection size, Shopify throttling, and retries;
this is eventual reconciliation, not a guarantee of instant or permanent parity.

Each audit completes and validates the canonical Shopify read before writes,
compares both DB and index sets, and invokes the existing strict product sync
only for differences. That standard sync refreshes canonical product data;
unchanged products are not rewritten. DB/index writes are not one distributed
transaction: partial failures invalidate caches and retries re-read Shopify.
Missing pages, changed counts, ownership failures, failed index tasks, or failed
verification never report success or advance the audit cursor.

Progress and failures are retained in the shop-owned Redis keys
`membershipAuditCursor:{shop}` and `membershipAuditStatus:{shop}`, and failed
jobs are retained in `collectionMembershipQueueV1`. Worker readiness and shutdown
include this processor. It does not occupy web, ranking, or webhook worker slots.

One-time repairs must use a freshly verified allowlist and backup. The current
allowlist consists of the 28 New Arrivals links and one Wedding link established
by the read-only audit; product records themselves are present. Preserve prices,
stock, merchant rules, unrelated memberships, and SoBooster configuration.
Source-only unavailable products must not be unhidden to force a match.

These safeguards do not implement SoBooster's unverified tie-break or delete
otherwise valid Shopify products merely because its captured results omit them.
