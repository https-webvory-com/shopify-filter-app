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
  const options = { token, provider:'gemini', apiKey: "fixture-key", fetchImpl: async () => { calls++; throw new Error("must not call"); } };
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
  const options = { token, provider:'gemini', apiKey: "fixture-key", fetchImpl: async (url, init) => {
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
    token, provider:'gemini', apiKey: "fixture-secret", fetchImpl: async () => Response.json({ embeddings: [{ values: [1, 2] }] }),
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
  assert.equal(config.request.provider, 'gemini');
  assert.ok(!JSON.stringify(config).includes("generativelanguage.googleapis.com"));
});

test('OpenAI relay sends batches and restores provider response order without Gemini calls', async () => {
  let calls = 0;
  const texts = ['openai fixture paid dress','openai fixture summer shirt','openai fixture paid dress'];
  const options = {token,provider:'openai',apiKey:'openai-fixture-key',fetchImpl:async(url,init)=>{
    calls++;
    assert.equal(url,'https://api.openai.com/v1/embeddings');
    assert.equal(init.headers.Authorization,'Bearer openai-fixture-key');
    assert.equal(init.headers['x-goog-api-key'],undefined);
    assert.deepEqual(JSON.parse(init.body),{model:'text-embedding-3-small',input:texts.slice(0,2),dimensions:768,encoding_format:'float'});
    return Response.json({data:[{index:1,embedding:Array(768).fill(2)},{index:0,embedding:Array(768).fill(1)}]});
  }};
  const response = await handleEmbeddingRelay(request({provider:'openai',texts}),options);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).embeddings.map(e=>e.values[0]),[1,2,1]);
  assert.equal((await handleEmbeddingRelay(request({provider:'openai',texts}),options)).status,200);
  assert.equal(calls,1);
});

test('OpenAI relay rejects stale Gemini requests before calling either provider', async () => {
  let calls = 0;
  const options = {token,provider:'openai',apiKey:'key',fetchImpl:async()=>{calls++;throw Error('unexpected');}};
  for (const provider of [undefined,'gemini']) {
    assert.equal((await handleEmbeddingRelay(request({texts:['mismatch fixture'],provider}),options)).status,409);
  }
  assert.equal(calls,0);
});

test('OpenAI never falls back to a Gemini key or provider on errors', async () => {
  assert.equal((await handleEmbeddingRelay(request({provider:'openai',texts:['no key fixture']}),
    {token,provider:'openai',apiKey:''})).status,503);
  let calls = 0;
  const response = await handleEmbeddingRelay(request({provider:'openai',texts:['provider auth error fixture']}),
    {token,provider:'openai',apiKey:'key',fetchImpl:async url=>{calls++;assert.equal(url,'https://api.openai.com/v1/embeddings');return new Response('private error',{status:401});}});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'Embedding provider unavailable'});
  assert.equal(calls,1);
});

test('relay isolates identical text caches across providers and credentials', async () => {
  const texts = ['provider cache isolation fixture'];
  for (const [provider,apiKey,value] of [['gemini','key1',1],['openai','key1',2],['openai','key2',3]]) {
    const response = await handleEmbeddingRelay(request({provider,texts}),{token,provider,apiKey,fetchImpl:async()=>Response.json(
      provider === 'openai' ? {data:[{index:0,embedding:Array(768).fill(value)}]} : {embeddings:[{values:Array(768).fill(value)}]})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).embeddings[0].values[0],value);
  }
});

test('OpenAI relay rejects duplicate indexes and invalid vectors', async () => {
  for (const [label,data] of [['short',[{index:0,embedding:[1]}]],['indexes',[{index:1,embedding:Array(768).fill(0)}]]]) {
    const response=await handleEmbeddingRelay(request({provider:'openai',texts:[`invalid openai ${label}`]}),
      {token,provider:'openai',apiKey:'key',fetchImpl:async()=>Response.json({data})});
    assert.equal(response.status,503);
  }
});
