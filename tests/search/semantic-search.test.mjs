import test from "node:test";
import assert from "node:assert/strict";
import { geminiEmbedder, withSemanticSearch, semanticFallback, semanticProvider, semanticEmbedderSettings, semanticRelayEmbedder } from "../../app/utils/semanticSearch.js";

test("semantic requests retain tenant, filters, page and explicit sort", () => {
  const query = { q: "dress for beach wedding", filter: ["shop = 'fixture'", "available = true"], sort: ["priceMin:asc"], offset: 25, limit: 25 };
  const prepared = withSemanticSearch(query, true);
  assert.deepEqual(prepared, { ...query, hybrid: { embedder: "openai", semanticRatio: 0.5 } });
  assert.equal(withSemanticSearch(query, false), query);
  const empty = { q: "", filter: query.filter };
  assert.equal(withSemanticSearch(empty, true), empty);
});

test('OpenAI is selected by default even when a Gemini key exists', () => {
  assert.equal(semanticProvider({GEMINI_API_KEY:'gemini-key'}), 'openai');
  const settings = semanticEmbedderSettings({OPENAI_API_KEY:'openai-key',GEMINI_API_KEY:'gemini-key'});
  assert.equal(settings.openai.source, 'openAi');
  assert.equal(settings.openai.apiKey, 'openai-key');
  assert.equal(settings.openai.model, 'text-embedding-3-small');
  assert.equal(settings.openai.dimensions, 768);
  assert.equal(settings.default, null);
  assert.equal(settings.gemini, null);
  assert.throws(()=>semanticEmbedderSettings({GEMINI_API_KEY:'gemini-key'}), /OPENAI_API_KEY/);
});

test('Gemini requires an explicit switch and its own key', () => {
  const settings = semanticEmbedderSettings({SEMANTIC_EMBEDDING_PROVIDER:'gemini',GEMINI_API_KEY:'gemini-key'});
  assert.equal(settings.openai, null);
  assert.equal(settings.gemini.source, 'rest');
  assert.equal(settings.gemini.request.model, 'models/gemini-embedding-2');
  assert.equal(withSemanticSearch({q:'dress'},true,'gemini').hybrid.embedder, 'gemini');
  assert.throws(()=>semanticEmbedderSettings({SEMANTIC_EMBEDDING_PROVIDER:'gemini',OPENAI_API_KEY:'openai-key'}), /GEMINI_API_KEY/);
  assert.throws(()=>semanticProvider({SEMANTIC_EMBEDDING_PROVIDER:'invalid'}), /Unsupported/);
});

test('relay setup pins the provider and rejects partial configuration', () => {
  const env = {OPENAI_API_KEY:'key',SEMANTIC_RELAY_URL:'https://fixture/embeddings',SEMANTIC_RELAY_TOKEN:'token'};
  assert.deepEqual(semanticEmbedderSettings(env).openai, semanticRelayEmbedder(env.SEMANTIC_RELAY_URL,env.SEMANTIC_RELAY_TOKEN,'openai'));
  assert.equal(semanticEmbedderSettings(env).openai.request.provider, 'openai');
  assert.throws(()=>semanticEmbedderSettings({...env,SEMANTIC_RELAY_TOKEN:''}), /required/);
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
  assert.match(config.documentTemplate, /field.name == 'title'/);
  assert.match(config.documentTemplate, /field.name == 'option_Color'/);
  assert.match(config.documentTemplate, /field.value != nil/);
  assert.equal(config.dimensions, config.request.outputDimensionality);
  assert.equal(config.response.embedding.values, "{{embedding}}");
});
