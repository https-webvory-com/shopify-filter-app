export function geminiEmbedder(apiKey) {
  return {
    source: "rest",
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${encodeURIComponent(apiKey)}`,
    dimensions: 768,
    request: { model: "models/gemini-embedding-2", content: { parts: [{ text: "{{text}}" }] }, outputDimensionality: 768 },
    response: { embedding: { values: "{{embedding}}" } },
    documentTemplate: "{% for field in fields %}{% if field.name == 'title' or field.name == 'productType' or field.name == 'vendor' or field.name == 'option_Color' or field.name == 'tags' or field.name == 'metafield_global.description_tag' %}{% if field.value != nil %}{{field.name}}: {{field.value}}. {% endif %}{% endif %}{% endfor %}",
    documentTemplateMaxBytes: 2000,
  };
}

export function geminiRelayEmbedder(url, token) {
  return semanticRelayEmbedder(url, token, 'gemini');
}

export function semanticRelayEmbedder(url, token, provider = 'openai') {
  semanticProvider({ SEMANTIC_EMBEDDING_PROVIDER: provider });
  if (!url || !token) throw new Error("Semantic relay URL and token are required");
  const { documentTemplate, documentTemplateMaxBytes, dimensions } = geminiEmbedder("");
  return {
    source: "rest", url, apiKey: token, dimensions,
    request: { provider, texts: ["{{text}}", "{{..}}"] },
    response: { embeddings: [{ values: "{{embedding}}" }, "{{..}}"] },
    documentTemplate, documentTemplateMaxBytes,
  };
}

// Keep filters, pagination and explicit sorting intact in both modes.
export function withSemanticSearch(query, enabled, provider = 'openai') {
  if (!enabled || !query.q?.trim()) return query;
  return { ...query, hybrid: { embedder: provider, semanticRatio: 0.5 } };
}

export async function semanticFallback(run, queries) {
  try {
    return await run(queries);
  } catch (error) {
    if (!queries.some(query => query.hybrid)) throw error;
    return run(queries.map(({ hybrid, ...query }) => query));
  }
}
export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

export function semanticProvider(env = process.env) {
  const provider = (env.SEMANTIC_EMBEDDING_PROVIDER || 'openai').trim().toLowerCase();
  if (!['openai', 'gemini'].includes(provider)) throw new Error('Unsupported semantic embedding provider');
  return provider;
}

export function openaiEmbedder(apiKey) {
  const { documentTemplate, documentTemplateMaxBytes } = geminiEmbedder('');
  return { source: 'openAi', apiKey, model: OPENAI_EMBEDDING_MODEL, dimensions: 768,
    documentTemplate, documentTemplateMaxBytes };
}

export function semanticEmbedderSettings(env = process.env) {
  const provider = semanticProvider(env);
  const apiKey = provider === 'openai' ? env.OPENAI_API_KEY : env.GEMINI_API_KEY;
  if (!apiKey) throw new Error(`${provider === 'openai' ? 'OPENAI' : 'GEMINI'}_API_KEY is required for semantic setup`);
  const relayConfigured = env.SEMANTIC_RELAY_URL || env.SEMANTIC_RELAY_TOKEN;
  const config = relayConfigured
    ? semanticRelayEmbedder(env.SEMANTIC_RELAY_URL, env.SEMANTIC_RELAY_TOKEN, provider)
    : provider === 'openai' ? openaiEmbedder(apiKey) : geminiEmbedder(apiKey);
  // Retire the legacy Gemini default and inactive provider so indexing cannot
  // call an unselected provider. Each provider has its own vector space.
  return { default: null, openai: null, gemini: null, [provider]: config };
}
