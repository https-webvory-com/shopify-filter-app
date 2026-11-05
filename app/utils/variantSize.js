import { facetDisplayValue, facetValueKey } from './facetNormalization.js';

const NUMERIC_SIZE = /^(?:US\s*)?(\d{1,2})(W)?$/i;
const SIZE_OPTION = /^(?:dress\s+)?size$/i;

export function variantSizeEvidence(productOptions, selectedOptions, mappings = []) {
  const names = (productOptions || []).filter(option => SIZE_OPTION.test(facetDisplayValue(option.name)));
  const selected = (selectedOptions || []).filter(option => names.some(name => facetValueKey(name.name) === facetValueKey(option.name)));
  if (!selected.length) return { sizeUsNumeric: null, sizeMappingFlag: 'NO_SIZE_OPTION' };
  if (selected.length !== 1) return { sizeUsNumeric: null, sizeMappingFlag: 'AMBIGUOUS_SIZE_OPTION' };
  const raw = facetDisplayValue(selected[0].value);
  const key = facetValueKey(raw);
  const mapped = mappings.find(mapping => facetValueKey(mapping.sourceValue) === key);
  if (mapped) {
    const numeric = Number(mapped.sizeUsNumeric);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 40)
      return { sizeUsNumeric: numeric, sizeMappingFlag: null };
    return { sizeUsNumeric: null, sizeMappingFlag: 'INVALID_MAPPING' };
  }
  const match = NUMERIC_SIZE.exec(raw);
  if (match && Number(match[1]) <= 40)
    return { sizeUsNumeric: Number(match[1]), sizeMappingFlag: match[2] ? 'WIDE_SIZE' : null };
  return { sizeUsNumeric: null, sizeMappingFlag: raw ? 'UNMAPPED_SIZE' : 'EMPTY_SIZE' };
}
