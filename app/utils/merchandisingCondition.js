const numericFields = new Set(['Price', 'Discount', 'Percent sales', 'Available', 'Rating']);
const text = value => value == null ? null : typeof value === 'string' ? value : JSON.stringify(value);

// Keep display titles separate from target identity. Legacy title-only imports
// are safe only when a title resolves to exactly one shop-owned collection.
export async function resolveCollectionTargets(prisma, shop, collections, collectionIds, existing = null) {
  if (!Array.isArray(collections) || collections.some(c => typeof c !== 'string')) throw Error('Collections must be a list.');
  if (collectionIds != null && (!Array.isArray(collectionIds) || collectionIds.some(id => !/^(?:gid:\/\/shopify\/Collection\/)?\d+$/.test(String(id))))) throw Error('Invalid collection IDs.');
  const ids = [...new Set((collectionIds || []).map(id => `gid://shopify/Collection/${String(id).split('/').pop()}`))];
  if (!collections.length) {
    if (ids.length) throw Error('Selected collection names and IDs do not match.');
    return { collections: [], collectionIds: [] };
  }
  if (existing && JSON.stringify(collections) === JSON.stringify(existing.collections) &&
      (collectionIds == null || JSON.stringify(ids) === JSON.stringify(existing.collectionIds || []))) {
    return { collections, collectionIds: existing.collectionIds || [] };
  }
  const known = await prisma.collection.findMany({ where: { shop, OR: [{ title: { in: collections } }, { id: { in: ids } }] }, select: { id: true, title: true } });
  const previousIds = new Set(existing?.collectionIds || []);
  if (ids.some(id => !known.some(c => c.id === id) && !previousIds.has(id))) throw Error('A selected collection is unavailable in this store.');
  for (const title of collections) {
    if (known.some(c => c.title === title && ids.includes(c.id))) continue;
    const matches = known.filter(c => c.title === title);
    if (matches.length === 1) { if (!ids.includes(matches[0].id)) ids.push(matches[0].id); }
    else if (matches.length > 1) throw Error(`Select the specific collection for "${title}"; this title is shared by multiple collections.`);
    else if (!existing?.collections?.includes(title) || !ids.some(id => previousIds.has(id))) throw Error(`Collection "${title}" is unavailable in this store.`);
  }
  if (known.some(c => ids.includes(c.id) && !collections.includes(c.title))) throw Error('Selected collection names and IDs do not match.');
  return { collections, collectionIds: ids };
}

export function normalizeCondition(c) {
  const numeric = numericFields.has(c.field);
  return {
    action: c.action, field: c.field,
    value: text(c.value),
    minValue: numeric ? text(c.minValue ?? c.value) : null,
    maxValue: text(c.maxValue ?? c.value2),
    operator: c.operator, operand: text(c.operand), dateValue: c.dateValue,
  };
}

export function validConditions(conditions) {
  return Array.isArray(conditions) && conditions.length > 0 && conditions.every(c => {
    if (!c.field?.trim() || !c.action?.trim()) return false;
    if (numericFields.has(c.field)) {
      const min = c.minValue ?? c.value;
      const max = c.maxValue ?? c.value2;
      const present = v => v != null && String(v).trim() !== '';
      return (present(min) || present(max)) &&
        (!present(min) || Number.isFinite(Number(min))) &&
        (!present(max) || Number.isFinite(Number(max))) &&
        !(present(min) && present(max) && Number(min) > Number(max));
    }
    if (c.field === 'Date') {
      const [start, end] = String(c.dateValue || '').split(' - ');
      return Boolean(start && end && Number.isFinite(Date.parse(start)) && Number.isFinite(Date.parse(end)) && Date.parse(start) <= Date.parse(end));
    }
    return Array.isArray(c.value) ? c.value.length > 0 : Boolean(String(c.value ?? '').trim());
  });
}
