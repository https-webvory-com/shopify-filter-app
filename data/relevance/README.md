# Search relevance review

`search-queries-draft-200.csv` contains candidate queries, not relevance judgments. Each shop has 100 queries: the same 20 roadmap challenge terms plus 80 drawn independently from that shop's public collection sitemap. The UK sitemap was saved on 2026-10-30 and the US sitemap on 2026-11-05. Collection titles are a query draft, not proof that each collection currently has relevant products.

This draft applies only to these dress stores. For another merchant, create a separate 200-query set from that merchant's own catalog and searches; use its `shop` domain (for example `toys.myshopify.com`) and shopper `country` in each judged JSON row. The evaluator accepts any Shopify shop and does not impose clothing queries on unrelated stores.

Recreate this draft with `node scripts/create-relevance-draft.mjs path/to/uk-collections.xml path/to/us-collections.xml`. The two XML files are public Shopify collection sitemaps, and the checked-in draft records each source collection URL.

`scripts/create-relevance-candidates.mjs` accepts a query CSV with `store`, `shop`, `country`, and `query` columns for other merchants. For the US/UK draft, `store` supplies the country automatically. Candidate generation and evaluation send that country to the API, so market price and availability checks use the intended shopper context. It refuses to overwrite an output CSV once any `reviewed_grade` has been entered.

The candidate sheet includes product handles and response prices to help review. These are clues, not proof of a requested variant's color, size, price, or current availability; check the product in the same shopper country before grading those cases. `candidate_source=fallback` identifies independently discovered relevant candidates and leaves `result_rank` blank because they were not returned for the original query.

For each query, review search results and grade relevant product IDs from 0 (irrelevant) to 3 (excellent). Create a private JSON file with exactly 200 rows in this form:

```json
[
  {"store":"UK","query":"red prom dress","grades":{"123456789":3,"987654321":2}},
  {"store":"UK","query":"xyzqq","grades":{},"expectedZero":true}
]
```

The full file must include all 200 unique store/query pairs. For `promm dres`, add `"requiredRelevantHits":20` and grade at least 20 relevant products. The evaluator fetches up to 100 hits for that check. Keep this judged file outside Git if it contains merchant research.

Run `node scripts/evaluate-search-relevance.mjs path/to/judged.json https://aisearchfilter.webvory.com`. It reports mean nDCG@10 for queries with relevant products, zero-result/suggestion checks, and the weakest queries. A passing local evaluator does not establish live speed targets.
