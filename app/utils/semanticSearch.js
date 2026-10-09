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
