// Retrieve every candidate before applying rules that can change its position.
export async function collectCollectionCandidates(index, query, firstResult, totalCount) {
  const hits = [...(firstResult.hits || [])];
  const batchSize = query.limit;
  const { indexUid, q, ...searchOptions } = query;
  while (hits.length < totalCount) {
    const result = await index.search(q, {
      ...searchOptions,
      offset: hits.length,
      limit: batchSize,
    });
    if (!result.hits?.length) {
      throw new Error("Collection ranking could not retrieve all matching products");
    }
    hits.push(...result.hits);
  }
  return [...new Map(hits.map(hit => [String(hit.id), hit])).values()];
}

export function paginateRankedCollection(products, page, limit) {
  const start = (page - 1) * limit;
  return { totalCount: products.length, products: products.slice(start, start + limit) };
}
