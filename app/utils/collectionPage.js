const cleanId = id => String(id).split("/").pop();

// Count disjoint tiers together, then allocate pin and ordinary slots globally.
// Only IDs are cached; full product data is loaded for the requested page.
export async function fetchCollectionPage(index, { page, limit, pinnedIds, tiers, attributes, orderedIds = null, cacheIds = async (_key, fetchIds) => fetchIds() }) {
  const pins = [...new Set(pinnedIds.map(cleanId))];
  const pinSet = new Set(pins);
  const ranks = orderedIds ? new Map(orderedIds.map((id, rank) => [cleanId(id), rank])) : null;
  const start = (page - 1) * limit;
  const selected = pins.slice(start, start + limit);
  let offset = Math.max(0, start - pins.length);
  let remaining = limit - selected.length;
  let total = pins.length;
  const documents = new Map();

  for (const tier of tiers) {
    const { indexUid, q, ...options } = tier.query;
    let ordinaryIds;
    let ordinaryTotal = tier.total;
    if (pins.length || ranks) {
      const key = JSON.stringify([q, options.filter, options.sort, tier.total]);
      const ids = await cacheIds(key, async () => {
        const result = await index.search(q, { ...options, offset: 0, limit: tier.total, attributesToRetrieve: ["id"] });
        if (result.hits.length !== tier.total) throw new Error("Incomplete collection ID results");
        return result.hits.map(product => cleanId(product.id));
      });
      ordinaryIds = ids.filter(id => !pinSet.has(id));
      if (ranks) ordinaryIds.sort((a,b) => (ranks.get(a) ?? Infinity) - (ranks.get(b) ?? Infinity));
      ordinaryTotal = ordinaryIds.length;
    }
    total += ordinaryTotal;
    if (!remaining) continue;
    if (offset >= ordinaryTotal) { offset -= ordinaryTotal; continue; }
    const take = Math.min(remaining, ordinaryTotal - offset);
    if (ordinaryIds) {
      selected.push(...ordinaryIds.slice(offset, offset + take));
    } else {
      const result = await index.search(q, { ...options, offset, limit: take, attributesToRetrieve: attributes });
      for (const product of result.hits) {
        const id = cleanId(product.id);
        selected.push(id);
        documents.set(id, product);
      }
    }
    remaining -= take;
    offset = 0;
  }

  const missing = selected.filter(id => !documents.has(id));
  // getDocuments({ids}) is unsupported on the deployed server. Individual
  // document reads work without making id a filterable index attribute.
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(missing.slice(i, i + 8).map(async id => {
      try {
        documents.set(id, await index.getDocument(id, { fields: attributes }));
      } catch (error) {
        if (!pinSet.has(id) || (error?.cause?.code || error?.code) !== "document_not_found") throw error;
        // The route hydrates valid DB pins that have not reached the index yet.
        documents.set(id, { id });
      }
    }));
  }
  return { hits: selected.map(id => documents.get(id)), total };
}
