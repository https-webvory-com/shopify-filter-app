// CSV row numbers refer to records, including the header (first data record = 2).
export function importRowInfo(row, index = 0) {
  return { row: Number.isInteger(row?.sourceRow) && row.sourceRow >= 2 ? row.sourceRow : index + 2, name: String(row?.sourceName || row?.name || row?.externalId || row?.searchQuery || (Array.isArray(row?.collectionTitles) ? row.collectionTitles.join(', ') : '') || 'Unnamed rule') };
}
export function csvRowMetadata(row, index, kind, parseErrors = []) {
  const info = { sourceRow: index + 2, sourceName: String(row.Name || row.name || row.Id || row.SearchQuery || row.CollectionTitles || 'Unnamed rule') };
  const errors = parseErrors.filter(e => e.row == null || e.row === index).map(e => 'CSV format: ' + e.message);
  if (kind === 'merchandising' && !String(row.Name || row.name || '').trim()) errors.push('Rule name is missing.');
  const arrays = kind === 'merchandising' ? ['Conditions', 'CollectionTitles', 'SearchQueries'] : ['Products', 'CollectionTitles', 'Collections', 'SearchQueries'];
  for (const field of arrays) {
    if (row[field] == null || row[field] === '') {
      if (field === 'Conditions' || field === 'Products') errors.push(field + ' is missing.');
      continue;
    }
    try {
      const values = JSON.parse(row[field]);
      if (!Array.isArray(values)) throw Error();
      if (['CollectionTitles', 'SearchQueries'].includes(field) && values.some(v => typeof v !== 'string')) throw Error();
      if (['Conditions', 'Products'].includes(field) && values.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw Error();
    } catch { errors.push(field + ' must contain a valid JSON array.'); }
  }
  return { ...info, importError: errors.join(' ') };
}
export function groupMerchandisingImports(rules) {
  const groups = new Map();
  for (const input of rules) {
    const rule = { ...input, searchQueries: Array.isArray(input.searchQueries) ? input.searchQueries : [], collections: Array.isArray(input.collections) ? input.collections : [], conditions: Array.isArray(input.conditions) ? input.conditions : [] };
    const key = rule.sourceName === 'Unnamed rule' ? `unnamed-row-${rule.sourceRow}` : rule.name;
    if (!groups.has(key)) { groups.set(key, { ...rule, sourceRows: [rule.sourceRow], searchQueries: [...rule.searchQueries], collections: [...rule.collections], conditions: [...rule.conditions] }); continue; }
    const group = groups.get(key);
    group.sourceRows.push(rule.sourceRow);
    group.searchQueries = [...new Set([...group.searchQueries, ...rule.searchQueries])];
    group.collections = [...new Set([...group.collections, ...rule.collections])];
    group.conditions.push(...rule.conditions);
    if (rule.customerTags) group.customerTags = [...new Set((group.customerTags + ',' + rule.customerTags).split(',').map(s => s.trim()).filter(Boolean))].join(', ');
    if (rule.importError) group.importError = [group.importError, `CSV row ${rule.sourceRow}: ${rule.importError}`].filter(Boolean).join(' ');
  }
  return [...groups.values()];
}
export function importSummary(report) {
  return `${report.imported ?? report.count ?? 0} imported, ${report.skipped || 0} skipped${report.unconfirmed ? `, ${report.unconfirmed} unconfirmed` : ''}${report.warnings?.length ? `, ${report.warnings.length} warning(s)` : ''}.`;
}
export function importWriteError(error) {
  if (error?.code === 'P2002') return 'A conflicting rule already exists. Rename the rule or update the existing one.';
  if (error?.code === 'P2000') return 'A rule value is too long to save.';
  if (error?.code === 'P2025') return 'The existing rule changed or was deleted during import. Refresh and retry.';
  return 'The save failed or could not be confirmed. Check existing rules and your connection before retrying. Existing rules are not deleted before saving.';
}
export function normalizePinImportRow(input, index) {
  const row = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  let importError = row.importError || (row === input ? '' : 'CSV row is not a valid rule.');
  const result = { ...row, ...importRowInfo(row, index) };
  result.sourceRow = result.row;
  result.sourceName = result.name;
  for (const key of ['products', 'collectionTitles', 'collectionIds']) {
    if (row[key] != null && !Array.isArray(row[key])) importError ||= `${key} must contain a valid list.`;
    result[key] = Array.isArray(row[key]) ? row[key] : [];
  }
  if (row.searchQueries != null && !Array.isArray(row.searchQueries)) { importError ||= 'Search queries must contain a valid list.'; result.searchQueries = []; }
  if (result.products.some(p => !p || typeof p !== 'object' || Array.isArray(p))) { importError ||= 'Products contains an invalid product entry.'; result.products = []; }
  if (result.collectionTitles.some(t => typeof t !== 'string') || result.searchQueries?.some(t => typeof t !== 'string')) importError ||= 'Collection titles and search queries must contain text values.';
  return { ...result, importError };
}
