const cleanId = id => String(id).split('/').pop();

// Rank and exclude the complete eligible set before allocating any page slots.
export async function buildCollectionSequence(index, { query, pinnedIds, orderedIds, arrange }) {
  const { indexUid, q, ...options } = query;
  const documents = [];
  const seen = new Set();
  const batchSize = 1000;
  for (let offset = 0; ; offset += batchSize) {
    const result = await index.search(q, {
      ...options, offset, limit: batchSize,
      attributesToRetrieve: ['id', 'title', 'vendor', 'productType', 'tags', 'priceMin', 'variantPrices', 'options', 'collections', 'collection_titles', 'bestSellingScore', 'trendingScore', 'createdAt'],
    });
    for (const product of result.hits) {
      const id = cleanId(product.id);
      if (seen.has(id)) throw new Error('Collection changed while ranking; retry the request');
      seen.add(id);
      documents.push({ ...product, id });
    }
    if (result.hits.length < batchSize) {
      const expected = result.totalHits ?? result.estimatedTotalHits;
      if (expected != null && documents.length !== expected) throw new Error('Incomplete collection ranking results');
      break;
    }
  }
  const ranks = orderedIds ? new Map(orderedIds.map((id, rank) => [cleanId(id), rank])) : null;
  if (ranks) documents.sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
  // Valid pins awaiting indexing must retain their slots for DB hydration.
  for (const id of pinnedIds.map(cleanId)) {
    if (!seen.has(id)) { documents.push({ id }); seen.add(id); }
  }
  const products = documents.map((p, i) => ({
    ...p, id: `gid://shopify/Product/${p.id}`, _originalIndex: i,
    variants: p.variantPrices || [],
    collections: p.collection_titles?.map(title => ({ collection: { title } })) || p.collections || [],
  }));
  return arrange(products).map(product => cleanId(product.id));
}

export async function readRankedCollectionPage(index, { ids, page, limit, attributes }) {
  const selected = ids.slice((page - 1) * limit, page * limit);
  const documents = new Map();
  for (let offset = 0; offset < selected.length; offset += 8) {
    await Promise.all(selected.slice(offset, offset + 8).map(async id => {
      try {
        const product = await index.getDocument(id, { fields: attributes });
        if (product.status && product.status.toUpperCase() !== 'ACTIVE') {
          throw new Error('Collection ranking session expired; product eligibility changed');
        }
        documents.set(id, product);
      }
      catch (error) {
        if (error.code !== 'document_not_found') throw error;
        documents.set(id, { id }); // Hydrate from DB without moving later page slots.
      }
    }));
  }
  return { hits: selected.map(id => documents.get(id)), total: ids.length };
}
