const colorWords = new Set('black white red blue green yellow orange pink purple brown grey gray royal navy burgundy gold silver fuchsia teal champagne ivory blush rose emerald aqua coral lilac magenta maroon peach plum sage sapphire taupe'.split(' '));
const normalize = value => String(value || '').trim().toLowerCase();
const words = value => normalize(value).split(/[^a-z]+/).filter(Boolean);
const oneEditApart = (a, b) => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};
const colorFamily = word => ({ navy: 'blue', royal: 'blue', sapphire: 'blue', aqua: 'blue',
  burgundy: 'red', maroon: 'red', emerald: 'green', sage: 'green', grey: 'gray',
  blush: 'pink', rose: 'pink', fuchsia: 'pink', magenta: 'pink', lilac: 'purple', plum: 'purple' }[word] || word);

function aliasMatchesRequestedColor(value, requested) {
  const known = words(value).filter(word => colorWords.has(word));
  // Unclassified names (e.g. Periwinkle) may be assigned by the merchant.
  // Known unrelated colors must not leak through a broad merged filter group.
  return !known.length || known.some(word => requested.some(term => colorFamily(term) === colorFamily(word)));
}

export function resolveSearchColor(query, colors, aliases = []) {
  const queryWords = words(query);
  const matchedWords = queryWords.filter(word => colorWords.has(word));
  const requested = matchedWords.length ? matchedWords : queryWords
    .filter(word => word.length >= 4)
    .flatMap(word => [...colorWords].filter(color => color.length >= 4 && color.startsWith(word.slice(0, 2)) && oneEditApart(word, color)).slice(0, 1));
  const consumedWords = matchedWords.length ? matchedWords : queryWords.filter(word =>
    requested.some(color => color.startsWith(word.slice(0, 2)) && oneEditApart(word, color)));
  const matches = new Set(colors.filter(color => words(color).some(word => requested.includes(word))));
  for (const alias of aliases) {
    if (!/^colou?r$/i.test(alias.filterType || '') && !/^colou?r$/i.test(alias.filterKey || '')) continue;
    const values = [alias.targetValue, ...(alias.sourceValues || [])].filter(Boolean);
    // Only the group's requested target may expand aliases. A matching source
    // in an unrelated group must not make all of that group's sources eligible.
    if (requested.includes(normalize(alias.targetValue))) {
      for (const color of colors) {
        if (values.some(value => normalize(value) === normalize(color)) && aliasMatchesRequestedColor(color, requested)) matches.add(color);
      }
    }
  }
  return { requested, values: [...matches], queryWords: consumedWords };
}

export function colorSearchFilter(intent, fields = ['option_Color']) {
  if (!intent?.requested?.length) return null;
  // An explicit color without catalog matches must never broaden to other colors.
  if (!intent.values.length || !fields.length) return 'id = "__no_matching_search_color__"';
  return '(' + fields.map(field => `${field} IN ${JSON.stringify(intent.values)}`).join(' OR ') + ')';
}

export function selectSearchColorVariant(product, values, requested = []) {
  let options = product.options || [];
  if (typeof options === 'string') { try { options = JSON.parse(options); } catch { options = []; } }
  const position = options.findIndex(option => /^colou?r$/i.test(option.name || ''));
  if (position < 0) return null;
  const key = `option${position + 1}`;
  const candidates = (product.variants || product.variantPrices || []).filter(variant =>
    values.some(value => normalize(value) === normalize(variant[key])));
  const literal = candidates.filter(v => words(v[key]).some(word => requested.includes(word)));
  // Prefer a literal requested color over merchant aliases, while retaining
  // availability priority. Never select an unrelated first product variant.
  const preferred = literal.some(v => v.available !== false) ? literal : candidates;
  const variant = preferred.find(v => v.available !== false && v.imageUrl)
    || preferred.find(v => v.available !== false) || preferred.find(v => v.imageUrl) || preferred[0];
  if (!variant) return null;
  // Reuse only an image from the same color, never the product's unrelated first image.
  let imageUrl = variant.imageUrl || candidates.find(v => normalize(v[key]) === normalize(variant[key]) && v.imageUrl)?.imageUrl || null;
  // A single-color product can safely use its product gallery when none of
  // that color's variants has an image. Mixed-color galleries remain excluded.
  const allVariants = product.variants || product.variantPrices || [];
  if (!imageUrl && allVariants.length && allVariants.every(v => normalize(v[key]) === normalize(variant[key]))) {
    const first = product.images?.[0];
    imageUrl = typeof first === 'string' ? first : first?.url || first?.src || null;
  }
  return { ...variant, imageUrl, searchColor: variant[key] };
}
