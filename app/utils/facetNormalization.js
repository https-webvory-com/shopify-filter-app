export const facetDisplayValue = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
export const facetValueKey = value => facetDisplayValue(value).toLocaleLowerCase('en');

const sizeAliases = {
  XS: ['XS', 'Extra Small', 'X Small', 'X-Small'],
  S: ['S', 'Small'],
  M: ['M', 'Medium'],
  L: ['L', 'Large'],
  XL: ['XL', 'X Large', 'X-Large', 'Extra Large'],
  '2XL': ['2XL', 'XXL', '2X', '2X Large', '2X-Large', 'XX Large', 'XX-Large', 'Extra Extra Large'],
  '3XL': ['3XL', 'XXXL', '3X', '3X Large', '3X-Large', 'XXX Large', 'XXX-Large'],
  '4XL': ['4XL', 'XXXXL', '4X', '4X Large', '4X-Large'],
  'One Size': ['One Size', 'OS', 'O/S', 'One Size Fits All'],
};
const sizeByAlias = new Map(Object.entries(sizeAliases).flatMap(([canonical, aliases]) =>
  aliases.map(alias => [facetValueKey(alias).replace(/[\s-]+/gu, ''), canonical])));
export const isSizeFacet = type => facetValueKey(type) === 'size';
export function canonicalSize(value) {
  return sizeByAlias.get(facetValueKey(value).replace(/[\s-]+/gu, '')) || null;
}

export function mappedFacetValue(type, rawValue, mergedValues = []) {
  const key = facetValueKey(rawValue);
  const rule = mergedValues.find(item => facetValueKey(item.filterType) === facetValueKey(type) &&
    (item.sourceValues || []).some(source => facetValueKey(source) === key));
  // Unmapped values keep their exact filter token until index normalization
  // can supply a canonical token and its raw-to-canonical mapping together.
  return rule ? facetDisplayValue(rule.targetValue) : isSizeFacet(type) ? canonicalSize(rawValue) || rawValue : rawValue;
}

// Build once per response. Large catalogs can have thousands of distinct tags
// and colors; repeatedly normalizing every saved rule for each value is costly.
export function createFacetValueMapper(mergedValues = []) {
  const rules = new Map();
  for (const rule of mergedValues) {
    const type = facetValueKey(rule.filterType);
    if (!rules.has(type)) rules.set(type, new Map());
    const values = rules.get(type);
    for (const source of rule.sourceValues || []) {
      const key = facetValueKey(source);
      if (!values.has(key)) values.set(key, facetDisplayValue(rule.targetValue));
    }
  }
  const types = new Map();
  return (type, rawValue) => {
    if (!types.has(type)) types.set(type, { rules: rules.get(facetValueKey(type)), size: isSizeFacet(type), values: new Map() });
    const entry = types.get(type);
    if (!entry.values.has(rawValue)) {
      const key = facetValueKey(rawValue);
      entry.values.set(rawValue, entry.rules?.has(key) ? entry.rules.get(key)
        : entry.size ? canonicalSize(rawValue) || rawValue : rawValue);
    }
    return entry.values.get(rawValue);
  };
}

export function expandMappedFacetValues(type, selected, mergedValues = []) {
  const key = facetValueKey(selected);
  const configured = mergedValues.filter(item => facetValueKey(item.filterType) === facetValueKey(type) &&
    facetValueKey(item.targetValue) === key).flatMap(item => item.sourceValues || []);
  const canonical = isSizeFacet(type) && canonicalSize(selected);
  return [...new Set([...configured, ...(canonical ? sizeAliases[canonical] : [])])];
}
