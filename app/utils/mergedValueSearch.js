const normalize = value => String(value || '').normalize('NFKC').toLowerCase();

// Build once per saved-rule snapshot, rather than scanning the catalog or
// repeatedly joining every source-value list while the merchant types.
export function createMergedValueSearchIndex(rules = []) {
  const indexed = rules.map((rule, position) => ({rule, position,
    createdAt: new Date(rule.createdAt).getTime() || 0,
    text: [rule.filterKey, rule.filterType, rule.targetValue, ...(rule.sourceValues || [])].map(normalize).join('\0'),
  }));
  return ({query = '', sort = 'newest', page = 1, pageSize = 20} = {}) => {
    const term = normalize(query).trim();
    const matches = indexed.filter(entry => !term || entry.text.includes(term));
    matches.sort((a, b) => (sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt) || a.position - b.position);
    const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
    const currentPage = Math.max(1, Math.min(totalPages, Number.parseInt(page, 10) || 1));
    return {rules: matches.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(entry => entry.rule),
      pagination: {currentPage, totalPages, totalItems: matches.length, sort, search: query}};
  };
}
