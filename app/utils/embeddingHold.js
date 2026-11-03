// Keep existing vectors when the embedding provider is unavailable. Meilisearch
// can still update product fields and search those fields with keyword queries.
export function withHeldEmbeddings(documents, enabled = process.env.SEMANTIC_EMBEDDING_REGENERATION_ENABLED) {
  if (enabled !== 'false') return documents;
  return documents.map(document => ({
    ...document,
    _vectors: {
      ...(document._vectors || {}),
      openai: { ...(document._vectors?.openai || {}), regenerate: false },
    },
  }));
}

export async function withHeldEmbeddingsForIndex(index, documents, enabled = process.env.SEMANTIC_EMBEDDING_REGENERATION_ENABLED) {
  if (enabled !== 'false') return documents;
  const settings = await index.getSettings();
  return settings.embedders?.openai ? withHeldEmbeddings(documents, enabled) : documents;
}
