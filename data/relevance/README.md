# Search relevance review

`search-queries-draft-200.csv` contains candidate queries, not relevance judgments. It pairs 100 UK queries with the same 100 US queries. Twenty are challenge terms from the roadmap; the other 80 came from the UK public collection sitemap on 2026-10-30. US catalog coverage has not been checked.

This draft applies only to these dress stores. For another merchant, create a separate 200-query set from that merchant's own catalog and searches; use its `shop` domain (for example `toys.myshopify.com`) in each judged JSON row. The evaluator accepts any Shopify shop and does not impose clothing queries on unrelated stores. Review US candidates against the US catalog before judging them.

`scripts/create-relevance-candidates.mjs` accepts a query CSV with `store`, `shop`, and `query` columns for other merchants. It refuses to overwrite an output CSV once any `reviewed_grade` has been entered.

For each query, review search results and grade relevant product IDs from 0 (irrelevant) to 3 (excellent). Create a private JSON file with exactly 200 rows in this form:

```json
[
  {"store":"UK","query":"red prom dress","grades":{"123456789":3,"987654321":2}},
  {"store":"UK","query":"xyzqq","grades":{},"expectedZero":true}
]
```

The full file must include all 200 unique store/query pairs. For `promm dres`, add `"requiredRelevantHits":20` and grade at least 20 relevant products. The evaluator fetches up to 100 hits for that check. Keep this judged file outside Git if it contains merchant research.

Run `node scripts/evaluate-search-relevance.mjs path/to/judged.json https://aisearchfilter.webvory.com`. It reports mean nDCG@10 for queries with relevant products, zero-result/suggestion checks, and the weakest queries. A passing local evaluator does not establish live speed targets.
