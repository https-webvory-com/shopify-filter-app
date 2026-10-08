import test from "node:test";
import assert from "node:assert/strict";
import { geminiEmbedder, withSemanticSearch, semanticFallback } from "../../app/utils/semanticSearch.js";

test("semantic requests retain tenant, filters, page and explicit sort", () => {
  const query = { q: "dress for beach wedding", filter: ["shop = 'fixture'", "available = true"], sort: ["priceMin:asc"], offset: 25, limit: 25 };
  const prepared = withSemanticSearch(query, true);
  assert.deepEqual(prepared, { ...query, hybrid: { embedder: "default", semanticRatio: 0.5 } });
  assert.equal(withSemanticSearch(query, false), query);
  const empty = { q: "", filter: query.filter };
  assert.equal(withSemanticSearch(empty, true), empty);
});

test("provider failure retries the entire batch as keyword search, including facets", async () => {
  const queries = [{ q: "wedding outfit", filter: ["shop = 'fixture'"], limit: 25 }, { q: "wedding outfit", facets: ["vendor"], limit: 0 }];
  const calls = [];
  const result = await semanticFallback(async batch => {
    calls.push(batch);
    if (batch.some(query => query.hybrid)) throw new Error("Embedding unavailable");
    return { results: [{ hits: [{ id: "1" }] }, { facetDistribution: { vendor: { Example: 1 } } }] };
  }, queries.map(query => withSemanticSearch(query, true)));
  assert.deepEqual(calls[1], queries);
  assert.equal(result.results[0].hits[0].id, "1");
  assert.equal(result.results[1].facetDistribution.vendor.Example, 1);
});

test("ordinary keyword errors propagate without a redundant retry", async () => {
  let calls = 0;
  await assert.rejects(semanticFallback(async () => { calls++; throw new Error("offline"); }, [{ q: "" }]), /offline/);
  assert.equal(calls, 1);
});

test("Gemini embedding configuration uses document fields and matching dimensions", () => {
  const config = geminiEmbedder("fixture-key");
  assert.match(config.documentTemplate, /doc.title/);
  assert.equal(config.dimensions, config.request.outputDimensionality);
  assert.equal(config.response.embedding.values, "{{embedding}}");
});
