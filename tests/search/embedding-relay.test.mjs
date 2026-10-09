import test from "node:test";
import assert from "node:assert/strict";
import { handleEmbeddingRelay } from "../../app/services/embeddingRelay.server.js";
import { geminiRelayEmbedder } from "../../app/utils/semanticSearch.js";

const token = "fixture-relay-token";
const request = (body, authorization = `Bearer ${token}`) => new Request("http://app.internal/api/internal/embeddings", {
  method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("relay rejects unauthorized, invalid and oversized requests without provider calls", async () => {
  let calls = 0;
  const options = { token, apiKey: "fixture-key", fetchImpl: async () => { calls++; throw new Error("must not call"); } };
  assert.equal((await handleEmbeddingRelay(request({ texts: ["dress"] }, "Bearer incorrect"), options)).status, 401);
  for (const texts of [[], [" "], [1], Array(101).fill("dress"), ["x".repeat(8001)]]) {
    assert.equal((await handleEmbeddingRelay(request({ texts }), options)).status, 400);
  }
  assert.equal((await handleEmbeddingRelay(request({ texts: ["x".repeat(300000)] }), options)).status, 413);
  assert.equal(calls, 0);
});

test("relay batches, preserves duplicate order and caches embeddings", async () => {
  let calls = 0;
  const texts = ["relay fixture office dress", "relay fixture red dress", "relay fixture office dress"];
  const options = { token, apiKey: "fixture-key", fetchImpl: async (url, init) => {
    calls++;
    assert.match(url, /gemini-embedding-2:batchEmbedContents$/);
    assert.equal(init.headers["x-goog-api-key"], "fixture-key");
    const body = JSON.parse(init.body);
    assert.deepEqual(body.requests.map(item => item.content.parts[0].text), texts.slice(0, 2));
    assert.ok(body.requests.every(item => item.outputDimensionality === 768));
    return Response.json({ embeddings: body.requests.map((_, index) => ({ values: Array(768).fill(index + 1) })) });
  } };
  const response = await handleEmbeddingRelay(request({ texts }), options);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.embeddings.map(item => item.values[0]), [1, 2, 1]);
  assert.equal((await handleEmbeddingRelay(request({ texts }), options)).status, 200);
  assert.equal(calls, 1);
});

test("relay hides provider errors and rejects incorrect vector dimensions", async () => {
  const response = await handleEmbeddingRelay(request({ texts: ["relay malformed vector fixture"] }), {
    token, apiKey: "fixture-secret", fetchImpl: async () => Response.json({ embeddings: [{ values: [1, 2] }] }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Embedding provider unavailable" });
});

test("Meilisearch relay configuration uses private authenticated batched requests", () => {
  const config = geminiRelayEmbedder("http://10.0.1.75:3005/api/internal/embeddings", token);
  assert.equal(config.apiKey, token);
  assert.deepEqual(config.request.texts, ["{{text}}", "{{..}}"]);
  assert.deepEqual(config.response.embeddings, [{ values: "{{embedding}}" }, "{{..}}"]);
  assert.equal(config.dimensions, 768);
  assert.ok(!JSON.stringify(config).includes("generativelanguage.googleapis.com"));
});
