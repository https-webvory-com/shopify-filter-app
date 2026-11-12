import { filterBlacklistedSuggestions } from './suggestionBlacklist.js';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const words = value => clean(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

// Autocomplete labels are short plain text, never embedded widget markup.
export function cleanSuggestionText(value) {
  if (typeof value !== 'string') return '';
  const text = clean(value);
  if (!text || text.length > 300) return '';
  const probe = text.replace(/&(?:amp;)*lt;|&#0*60;|&#x0*3c;/gi, '<').replace(/&(?:amp;)*gt;|&#0*62;|&#x0*3e;/gi, '>');
  if (/<\/?[a-z][^>]*>|<!--|<!doctype\b/i.test(probe) || /\b(?:document|window)\s*\.\s*(?:write|getElementById|createElement|addEventListener)\s*\(/i.test(probe)) return '';
  return text;
}

export function buildSearchSuggestions(query, products = [], facets = [], limit = 6, blacklist = []) {
  const tokens = words(query);
  if (!tokens.length) return [];
  const candidates = [];
  const fallback = [];
  for (const product of products) {
    const title = cleanSuggestionText(product.title);
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
  return filterBlacklistedSuggestions(candidates.map(cleanSuggestionText).filter(value => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key); return true;
  }), blacklist).slice(0, limit);
}
