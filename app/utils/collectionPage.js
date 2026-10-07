const cleanId = id => String(id).split("/").pop();

// Pins occupy slots in the same sequence as the boosted and fallback tiers.
// Tier queries are disjoint; only this page's full products are retrieved.
export async function fetchCollectionPage(index, { page, limit, pinnedIds, tiers, attributes }) {
  const pins = [...new Set(pinnedIds.map(cleanId))];
  const start = (page - 1) * limit;
  const pagePins = pins.slice(start, start + limit);
  let offset = Math.max(0, start - pins.length);
  let remaining = limit - pagePins.length;
  const selected = [...pagePins];
  let ordinaryTotal = 0;

  for (const tier of tiers) {
    let matchingPins = [];
    if (pins.length) {
      const result = await index.getDocuments({ ids: pins, filter: tier.query.filter, fields: ["id"], limit: pins.length });
      matchingPins = result.results.map(product => cleanId(product.id));
    }
    const total = Math.max(0, tier.total - matchingPins.length);
    ordinaryTotal += total;
    if (!remaining) continue;
    if (offset >= total) { offset -= total; continue; }

    const take = Math.min(remaining, total - offset);
    const { indexUid, q, ...options } = tier.query;
    // Without pins, use native offset pagination directly. With pins, read
    // only IDs up to this page to account for their original positions.
    const result = await index.search(q, {
      ...options,
      attributesToRetrieve: ["id"],
      offset: matchingPins.length ? 0 : offset,
      limit: matchingPins.length ? offset + take + matchingPins.length : take,
    });
    const ids = result.hits.map(product => cleanId(product.id)).filter(id => !pins.includes(id));
    selected.push(...ids.slice(matchingPins.length ? offset : 0, (matchingPins.length ? offset : 0) + take));
    remaining -= take;
    offset = 0;
  }

  if (!selected.length) return { hits: [], total: pins.length + ordinaryTotal };
  const details = await index.getDocuments({ ids: selected, fields: attributes, limit: selected.length });
  const byId = new Map(details.results.map(product => [cleanId(product.id), product]));
  return { hits: selected.flatMap(id => byId.has(id) ? [byId.get(id)] : []), total: pins.length + ordinaryTotal };
}
