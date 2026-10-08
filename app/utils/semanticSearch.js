export function geminiEmbedder(apiKey) {
  return {
    source: "rest",
    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${encodeURIComponent(apiKey)}`,
    dimensions: 768,
    request: { model: "models/gemini-embedding-2", content: { parts: [{ text: "{{text}}" }] }, outputDimensionality: 768 },
    response: { embedding: { values: "{{embedding}}" } },
    documentTemplate: "{{doc.title}}. {{doc.productType}} by {{doc.vendor}}. {{doc.tags | join: ', '}}",
  };
}

// Keep filters, pagination and explicit sorting intact in both modes.
export function withSemanticSearch(query, enabled) {
  if (!enabled || !query.q?.trim()) return query;
  return { ...query, hybrid: { embedder: "default", semanticRatio: 0.5 } };
}

export async function semanticFallback(run, queries) {
  try {
    return await run(queries);
  } catch (error) {
    if (!queries.some(query => query.hybrid)) throw error;
    return run(queries.map(({ hybrid, ...query }) => query));
  }
}
