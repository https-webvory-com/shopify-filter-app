const colorWords = new Set('black white red blue green yellow orange pink purple brown grey gray royal navy burgundy gold silver fuchsia teal champagne ivory blush rose emerald aqua coral lilac magenta maroon peach plum sage sapphire taupe'.split(' '));
const normalize = value => String(value || '').trim().toLowerCase();
const words = value => normalize(value).split(/[^a-z]+/).filter(Boolean);

export function resolveSearchColor(query, colors, aliases = []) {
  const requested = words(query).filter(word => colorWords.has(word));
  const matches = new Set(colors.filter(color => words(color).some(word => requested.includes(word))));
  for (const alias of aliases) {
    if (!/^colou?r$/i.test(alias.filterType || '') && !/^colou?r$/i.test(alias.filterKey || '')) continue;
    const values = [alias.targetValue, ...(alias.sourceValues || [])].filter(Boolean);
    if (values.some(value => requested.includes(normalize(value)) || [...matches].some(match => normalize(match) === normalize(value)))) {
      for (const color of colors) if (values.some(value => normalize(value) === normalize(color))) matches.add(color);
    }
  }
  return { requested, values: [...matches] };
}

export function colorSearchFilter(intent, fields = ['option_Color']) {
  if (!intent?.requested?.length) return null;
  // An explicit color without catalog matches must never broaden to other colors.
  if (!intent.values.length || !fields.length) return 'id = "__no_matching_search_color__"';
  return '(' + fields.map(field => `${field} IN ${JSON.stringify(intent.values)}`).join(' OR ') + ')';
}

export function selectSearchColorVariant(product, values) {
  let options = product.options || [];
  if (typeof options === 'string') { try { options = JSON.parse(options); } catch { options = []; } }
  const position = options.findIndex(option => /^colou?r$/i.test(option.name || ''));
  if (position < 0) return null;
  const key = `option${position + 1}`;
  const candidates = (product.variants || product.variantPrices || []).filter(variant =>
    values.some(value => normalize(value) === normalize(variant[key])));
  const variant = candidates.find(v => v.available !== false && v.imageUrl)
    || candidates.find(v => v.available !== false) || candidates.find(v => v.imageUrl) || candidates[0];
  if (!variant) return null;
  // Reuse only an image from the same color, never the product's unrelated first image.
  const imageUrl = variant.imageUrl || candidates.find(v => normalize(v[key]) === normalize(variant[key]) && v.imageUrl)?.imageUrl || null;
  return { ...variant, imageUrl, searchColor: variant[key] };
}
