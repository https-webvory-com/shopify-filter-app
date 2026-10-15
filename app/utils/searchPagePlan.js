import { searchExactToken } from './searchIndexProjection.js';
const quote = JSON.stringify;
const FALSE = '(shop EXISTS AND NOT shop EXISTS)';
const customSort = {
  'price-ascending': ['priceMin:asc'], 'price-descending': ['priceMin:desc'],
  'title-ascending': ['title:asc'], 'title-descending': ['title:desc'],
  'created-ascending': ['createdAt:asc'], 'created-descending': ['createdAt:desc'],
};

function predicate(condition, required, mergedValues) {
  const field = condition.field || '';
  if (field === 'Date') {
    required.add('createdAt');
    const [from, to] = String(condition.dateValue || '').split(' - ');
    const min = Date.parse(from), max = Date.parse(to) + 86400000 - 1;
    return { filter: Number.isFinite(min) && Number.isFinite(max) ? `(createdAt >= ${min} AND createdAt <= ${max})` : FALSE, exact: true };
  }
  const numeric = { Price: 'cfpSearchPrice', Available: 'cfpSearchInventory', Discount: 'cfpSearchDiscount',
    'Percent sales': 'cfpSearchPercentSales', Rating: 'cfpSearchRating' }[field];
  if (numeric) {
    required.add(numeric);
    const lower = condition.minValue ?? condition.value, upper = condition.maxValue ?? condition.value2;
    const min = lower == null || lower === '' ? -Infinity : parseFloat(lower);
    const max = upper == null || upper === '' ? Infinity : parseFloat(upper);
    if (Number.isNaN(min) || Number.isNaN(max) || min === Infinity || max === -Infinity) return { filter: FALSE, exact: false };
    const parts = [`${numeric} EXISTS`, `${numeric} IS NOT NULL`];
    if (Number.isFinite(min)) parts.push(`${numeric} >= ${min}`);
    if (Number.isFinite(max)) parts.push(`${numeric} <= ${max}`);
    return { filter: '(' + parts.join(' AND ') + ')', exact: false };
  }
  let key = { Vendor: 'cfpSearchVendor', 'Product type': 'cfpSearchType', Tags: 'cfpSearchTags',
    Product: 'cfpSearchTitle', Collections: 'cfpSearchCollections', Id: 'id', ID: 'id', id: 'id', SKU: 'cfpSearchSkus' }[field];
  if (!key && /option|color|size|title/i.test(field)) key = 'cfpSearchOptionPhrases';
  if (!key) return null;
  let value = condition.value || '';
  if (typeof value !== 'string') return null;
  if (/^[\[{]/.test(value)) { try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) value = parsed.join(','); else if (typeof parsed === 'string') value = parsed; } catch {} }
  const values = value.split(',').map(s => s.replace(/[\[\]"']/g, '').trim().toLowerCase()).filter(Boolean)
    .map(v => key === 'id' ? v.replace('gid://shopify/product/', '') : key === 'cfpSearchSkus' ? v.split('|')[0].trim() : v);
  if (key === 'cfpSearchOptionPhrases' && field.includes('(product option)')) {
    for (const v of [...values]) for (const alias of mergedValues) {
      if (String(alias.targetValue || '').toLowerCase().trim() === v && Array.isArray(alias.sourceValues)) {
        for (const source of alias.sourceValues) {
          const term = String(source || '').toLowerCase().trim();
          if (term && !values.includes(term)) values.push(term);
        }
      }
    }
  }
  required.add(key);
  return { filter: values.length ? `${key} IN ${quote(key==='id'?values:values.map(searchExactToken))}` : FALSE, exact: true };
}

// Disjoint boolean groups reproduce the existing additive/positional scoring.
// Bound the plan size, not the matching products. Unsupported plans fall back.
export function compileSearchPagePlan(rule, sortBy = 'relevance', settings = {}, mergedValues = []) {
  if (sortBy === 'trending') return null;
  const conditions = rule?.conditions || [], required = new Set(['shop', 'status', 'id', 'cfpSearchVersion']);
  const exclusions = [], scoring = [];
  for (const [index, condition] of conditions.entries()) {
    if (!['Exclude', 'Boost', 'Bury', 'Pin', 'Dynamic'].includes(condition.action)) continue;
    const match = predicate(condition, required, mergedValues);
    if (!match) return null;
    if (condition.action === 'Exclude') exclusions.push(`NOT (${match.filter})`);
    else scoring.push({ ...match, condition, index });
  }
  if (scoring.length > 5) return null;
  const sort = customSort[sortBy] || (['best-selling', 'bestselling', 'manual'].includes(sortBy) ? ['bestSellingScore:desc'] : sortBy === 'trending' ? ['trendingScore:desc'] : []);
  if (!sort.length && !['relevance', 'r'].includes(sortBy)) return null;
  // The legacy comparator adds the sales score to merchandising for these
  // orders. Do not replace that arithmetic with a tier approximation.
  if (scoring.length && !customSort[sortBy] && !['relevance', 'r'].includes(sortBy)) return null;
  const ignoreMerch = !!customSort[sortBy] && settings.prioritizeSortOverMerchandising === true;
  const groups = [];
  for (let mask = 0; mask < (ignoreMerch ? 1 : 2 ** scoring.length); mask++) {
    let score = 0, pinned = false;
    const filter = [...exclusions];
    if (!ignoreMerch) for (let bit = 0; bit < scoring.length; bit++) {
      const item = scoring[bit], matches = !!(mask & (1 << bit));
      filter.push(matches ? `(${item.filter})` : `NOT (${item.filter})`);
      if (!matches) continue;
      const c = item.condition, weight = 10 ** (conditions.length - item.index + 3) * (item.exact ? 2 : 1);
      if (c.action === 'Boost') score += weight;
      if (c.action === 'Bury') score -= weight;
      if (c.action === 'Pin') { pinned = true; score += 100000000; }
      if (c.action === 'Dynamic') {
        const n = parseFloat(c.operand || c.value || '');
        if (!Number.isNaN(n)) {
          const op = (c.operator || 'Add').trim();
          if (op === 'Set') score = n;
          else if (['Add', '', 'Operator'].includes(op)) score += n;
          else if (op === 'Subtract') score -= n;
          else if (op === 'Multiply') score *= n;
          else if (op === 'Divide' && n !== 0) score /= n;
        }
      }
    }
    if (!Number.isFinite(score)) return null;
    groups.push({ score, pinned, filter });
  }
  groups.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.score - a.score);
  // Equal-scored groups must share the engine's relevance/sort order rather
  // than being concatenated in arbitrary mask order.
  const tiers = [];
  for (const group of groups) {
    const previous = tiers.at(-1);
    if (previous && previous.score === group.score && previous.pinned === group.pinned) previous.alternatives.push(group.filter);
    else tiers.push({ ...group, alternatives: [group.filter] });
  }
  return { required: [...required], sort, tiers: tiers.map(t => ({ ...t,
    filter: t.alternatives.some(a => !a.length) ? [] : ['(' + t.alternatives.map(a => '(' + a.join(' AND ') + ')').join(' OR ') + ')'] })) };
}
