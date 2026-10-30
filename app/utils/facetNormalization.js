export const facetDisplayValue = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
export const facetValueKey = value => facetDisplayValue(value).toLocaleLowerCase('en');

export function mappedFacetValue(type, rawValue, mergedValues = []) {
  const key = facetValueKey(rawValue);
  const rule = mergedValues.find(item => facetValueKey(item.filterType) === facetValueKey(type) &&
    (item.sourceValues || []).some(source => facetValueKey(source) === key));
  // Unmapped values keep their exact filter token until index normalization
  // can supply a canonical token and its raw-to-canonical mapping together.
  return rule ? facetDisplayValue(rule.targetValue) : rawValue;
}

export function expandMappedFacetValues(type, selected, mergedValues = []) {
  const key = facetValueKey(selected);
  return mergedValues.filter(item => facetValueKey(item.filterType) === facetValueKey(type) &&
    facetValueKey(item.targetValue) === key).flatMap(item => item.sourceValues || []);
}
