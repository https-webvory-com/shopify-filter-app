// Retrieve every candidate before applying rules that can change its position.
export async function collectCollectionCandidates(index, query, firstResult, totalCount) {
  const hits = [...(firstResult.hits || [])];
  const batchSize = query.limit;
  const { indexUid, q, ...searchOptions } = query;
  const firstOffset = hits.length;
  // Bound concurrency while avoiding one network round trip per batch.
  for (let offset = firstOffset; offset < totalCount; offset += batchSize * 3) {
    const offsets = [offset, offset + batchSize, offset + batchSize * 2].filter(value => value < totalCount);
    const results = await Promise.all(offsets.map(offset => index.search(q, { ...searchOptions, offset, limit: batchSize })));
    for (const result of results) {
      if (!result.hits?.length) throw new Error("Collection ranking could not retrieve all matching products");
      hits.push(...result.hits);
    }
  }
  return [...new Map(hits.map(hit => [String(hit.id), hit])).values()];
}

export async function hydrateCollectionPage(index, products, shop, attributesToRetrieve) {
  if (!products.length) return [];
  const ids = products.map(product => String(product.id).split("/").pop());
  if (ids.some(id => !/^\d+$/.test(id))) throw new Error("Invalid collection product ID");
  const result = await index.search("", {
    filter: [`shop = '${shop.replace(/'/g, "\\'")}'`, `id IN [${ids.join(",")}]`],
    limit: products.length,
    attributesToRetrieve,
  });
  const documents = new Map(result.hits.map(hit => [String(hit.id), hit]));
  return products.map(product => {
    const document = documents.get(String(product.id).split("/").pop());
    if (!document) throw new Error("Collection product details are unavailable");
    return { ...product, ...document, id: product.id, merchandisingVariantId: null, merchandisingImage: null };
  });
}

export function paginateRankedCollection(products, page, limit) {
  const start = (page - 1) * limit;
  return { totalCount: products.length, products: products.slice(start, start + limit) };
}
