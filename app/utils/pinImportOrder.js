// A file gets one group; every batch retains its original record position.
const orderPattern = /^(\d{13}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{10})$/i;
export function parsePinImportOrder(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(orderPattern);
  if (!match || Number(match[3]) < 2) return null;
  return { time: Number(match[1]), group: `${match[1]}:${match[2]}`, position: Number(match[3]) };
}
export function orderedPinImportRows(rows, group = `${Date.now()}:${crypto.randomUUID()}`) {
  return rows.map((row, index) => {
    const position = Number.isSafeInteger(row.sourceRow) && row.sourceRow >= 2 ? row.sourceRow : index + 2;
    const importOrder = `${group}:${String(position).padStart(10, '0')}`;
    if (!parsePinImportOrder(importOrder)) throw Error('Could not determine CSV rule order. Select the CSV again.');
    return { ...row, importOrder };
  });
}
export function sortPinningRules(rules, sort = 'default') {
  const created = rule => Number(new Date(rule.createdAt)) || 0;
  return [...rules].sort((a, b) => {
    if (sort === 'query-asc' || sort === 'query-desc') {
      const term = rule => rule.applyToAll ? '' : (rule.searchQueries?.[0] || '').trim();
      const compared = term(a).localeCompare(term(b), 'en', { sensitivity: 'base' });
      if (compared) return sort === 'query-desc' ? -compared : compared;
      return 0;
    }
    if (sort === 'recent') return created(b) - created(a);
    if (sort === 'oldest') return created(a) - created(b);
    const left = parsePinImportOrder(a.importOrder), right = parsePinImportOrder(b.importOrder);
    const time = (right?.time ?? created(b)) - (left?.time ?? created(a));
    if (time) return time;
    if (left && right) {
      // Different uploads can start in the same millisecond. Never interleave them.
      if (left.group !== right.group) return right.group.localeCompare(left.group);
      return left.position - right.position;
    }
    if (!!left !== !!right) return left ? -1 : 1;
    return 0;
  });
}
