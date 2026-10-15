export const SEARCH_SETTING_FIELDS = {
  instantEnabled: ['Enable instant search', true],
  productLimit: ['Instant search products', 6, 1, 20],
  suggestionLimit: ['Search suggestions', 6, 0, 10],
  collectionLimit: ['Collection suggestions', 5, 0, 10],
  recentLimit: ['Recent searches', 4, 0, 10],
  minChars: ['Characters before searching', 2, 1, 5],
  pageSize: ['Products per search results page', 25, 1, 40],
  showSearchInput: ['Show search box on the results page', true],
  showVendor: ['Show vendor on search results', true],
  showSale: ['Show sale label on search results', true],
  showSoldOut: ['Show sold out label on search results', true],
};
export const DEFAULT_SEARCH_SETTINGS = Object.freeze(Object.fromEntries([
  ...Object.entries(SEARCH_SETTING_FIELDS).map(([key, field]) => [key, field[1]]),
  ['manualSuggestions', []],
]));

export function validateSearchSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid search settings.');
  const result = {};
  for (const [key, [label, fallback, min, max]] of Object.entries(SEARCH_SETTING_FIELDS)) {
    const value = input[key];
    if (typeof fallback === 'boolean') {
      if (typeof value !== 'boolean') throw new Error(`${label}: choose enabled or disabled.`);
    } else if (!Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${label}: enter a whole number between ${min} and ${max}.`);
    }
    result[key] = value;
  }
  if (!Array.isArray(input.manualSuggestions) || input.manualSuggestions.length > 10) throw new Error('Enter up to 10 manual suggestions, one per line.');
  result.manualSuggestions = [];
  const seen = new Set();
  for (const item of input.manualSuggestions) {
    if (typeof item !== 'string' || /[\u0000-\u001f\u007f]/u.test(item)) throw new Error('Manual suggestions must be plain search terms.');
    const term = item.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!term || term.length > 100) throw new Error('Each manual suggestion must contain 1–100 characters.');
    if (!seen.has(term.toLowerCase())) result.manualSuggestions.push(term);
    seen.add(term.toLowerCase());
  }
  return result;
}
