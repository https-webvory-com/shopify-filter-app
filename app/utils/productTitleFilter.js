// Earlier editor versions saved the built-in product Title filter as a
// variant option. Normalize that known legacy shape without guessing from labels.
export function normalizeProductTitleFilter(filter) {
  if (!filter || typeof filter !== 'object') return filter;
  const type = filter.filterType || filter.type;
  const key = filter.filterKey || filter.key;
  if (type === 'title' || (type === 'option' && typeof key === 'string' && key.trim().toLowerCase() === 'title')) {
    return { ...filter, filterType: 'title', filterKey: null };
  }
  return filter;
}

// Reject only saved pages affected by the old Title representation/facets.
// Other collections keep their existing complete card publications.
export function hasUsableProductTitleFacets(payload) {
  const settings = Array.isArray(payload?.settings) ? payload.settings : [];
  const titles = settings.filter(filter => filter?.isEnabled && normalizeProductTitleFilter(filter)?.filterType === 'title');
  if (!titles.length) return true;
  if (titles.some(filter => filter.filterType !== 'title')) return false;
  if (!payload.facets) return payload.cfpCards?.facetsReady !== true;
  return Array.isArray(payload.facets.titles) && (payload.totalCount === 0 || payload.facets.titles.length > 0);
}
