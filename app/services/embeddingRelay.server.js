import { timingSafeEqual, createHash } from "node:crypto";
import { semanticProvider, OPENAI_EMBEDDING_MODEL } from '../utils/semanticSearch.js';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 100;
const DIMENSIONS = 768;
const MODEL = "models/gemini-embedding-2";
const cache = new Map();
const pending = new Map();
let active = 0;
const waiters = [];

async function acquire() {
  if (active >= 8) await new Promise(resolve => waiters.push(resolve));
  else active++;
}
function release() {
  const next = waiters.shift();
  if (next) next();
  else active--;
}
function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function authorized(request, token) {
  if (!token) return false;
  const actual = Buffer.from(request.headers.get("Authorization") || "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function readBody(request) {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function generate(texts, apiKey, fetchImpl, provider) {
  await acquire();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const openai = provider === 'openai';
      const response = await fetchImpl(openai ? 'https://api.openai.com/v1/embeddings' : `https://generativelanguage.googleapis.com/v1beta/${MODEL}:batchEmbedContents`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(openai ? {Authorization: `Bearer ${apiKey}`} : {"x-goog-api-key": apiKey}) },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify(openai ? {model: OPENAI_EMBEDDING_MODEL, input: texts, dimensions: DIMENSIONS, encoding_format: 'float'} :
          { requests: texts.map(text => ({ model: MODEL, content: { parts: [{ text }] }, outputDimensionality: DIMENSIONS })) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (attempt < 2 && [429, 500, 502, 503, 504].includes(response.status)) {
          await new Promise(resolve => setTimeout(resolve, Math.min(5000, Number(response.headers.get("Retry-After")) * 1000 || 500 * 2 ** attempt)));
          continue;
        }
        throw new Error("PROVIDER_UNAVAILABLE");
      }
      const result = await response.json();
      let embeddings = result.embeddings;
      if (openai) {
        const ordered = Array.isArray(result.data) ? [...result.data].sort((a,b) => a.index-b.index) : [];
        if (ordered.length !== texts.length || ordered.some((item,index) => item.index !== index)) throw new Error('INVALID_PROVIDER_RESPONSE');
        embeddings = ordered.map(item => ({values:item.embedding}));
      }
      if (embeddings?.length !== texts.length || embeddings.some(embedding =>
        !Array.isArray(embedding.values) || embedding.values.length !== DIMENSIONS || embedding.values.some(value => !Number.isFinite(value)))) {
        throw new Error("INVALID_PROVIDER_RESPONSE");
      }
      return embeddings;
    }
  } finally { release(); }
}

export async function handleEmbeddingRelay(request, {
  token = process.env.SEMANTIC_RELAY_TOKEN,
  provider = semanticProvider(),
  apiKey = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY,
  fetchImpl = fetch,
} = {}) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorized(request, token)) return json({ error: "Unauthorized" }, 401);
  if (!apiKey) return json({ error: "Embedding provider unavailable" }, 503);
  let texts, requestedProvider;
  try {
    ({ texts, provider: requestedProvider } = await readBody(request));
    // Legacy requests belong to the former Gemini relay. Reject them when
    // OpenAI is active rather than sending OpenAI vectors into a Gemini index.
    if ((requestedProvider || 'gemini') !== provider) return json({error:'Embedding provider mismatch'}, 409);
    if (!Array.isArray(texts) || texts.length < 1 || texts.length > MAX_BATCH || texts.some(text =>
      typeof text !== "string" || !text.trim() || text.length > 8000)) throw new Error("INVALID_BODY");
  } catch (error) {
    return json({ error: "Invalid embedding request" }, error.message === "BODY_TOO_LARGE" ? 413 : 400);
  }
  try {
    semanticProvider({SEMANTIC_EMBEDDING_PROVIDER:provider});
    const namespace = `${provider}:${createHash('sha256').update(apiKey).digest('hex')}:`;
    const key = text => namespace + text;
    const unique = [...new Set(texts)];
    const missing = unique.filter(text => !cache.has(key(text)) && !pending.has(key(text)));
    if (missing.length) {
      const batch = generate(missing, apiKey, fetchImpl, provider);
      missing.forEach((text, index) => {
        const embedding = batch.then(values => {
          const value = values[index];
          if (cache.size >= 256) cache.delete(cache.keys().next().value);
          cache.set(key(text), value);
          return value;
        }).finally(() => pending.delete(key(text)));
        pending.set(key(text), embedding);
      });
    }
    const values = new Map(await Promise.all(unique.map(async text => [text, cache.get(key(text)) || await pending.get(key(text))])));
    return json({ embeddings: texts.map(text => values.get(text)) });
  } catch {
    return json({ error: "Embedding provider unavailable" }, 503);
  }
}
