const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const words = value => clean(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

export function buildSearchSuggestions(query, products = [], facets = [], limit = 6) {
  const tokens = words(query);
  if (!tokens.length) return [];
  const candidates = [];
  const fallback = [];
  for (const product of products) {
    const title = clean(product.title);
    if (!title || (product.status && product.status.toLowerCase() !== 'active')) continue;
    const titleWords = words(title);
    let options = product.options;
    if (typeof options === 'string') {
      try { options = JSON.parse(options); } catch { options = []; }
    }
    const colors = (Array.isArray(options) ? options : []).filter(o => /colou?r/i.test(o?.name)).flatMap(o => o.values || []);
    const color = product.searchColor || colors.find(value => tokens.some(token => words(value).some(word => word.startsWith(token))));
    const matches = titleWords.some(word => tokens.some(token => word.startsWith(token))) || color;
    if (matches) candidates.push(color && !titleWords.includes(clean(color).toLowerCase()) ? `${clean(color)} ${title}` : title);
    else fallback.push(title);
  }
  candidates.push(...facets);
  candidates.push(...fallback);
  const seen = new Set();
  return candidates.map(clean).filter(value => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, limit);
}
