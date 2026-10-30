import test from 'node:test';
import assert from 'node:assert/strict';
import { facetDisplayValue, facetValueKey, mappedFacetValue, expandMappedFacetValues } from '../../app/utils/facetNormalization.js';

test('facet aliases match Unicode spaces and retain a clean display label', () => {
  const rules = [{ filterType: 'vendor', targetValue: 'Portia & Scarlett', sourceValues: ['Portia\u00a0&\u00a0Scarlett', 'PORTIA & SCARLETT'] }];
  assert.equal(facetDisplayValue(' Portia\u00a0&\u00a0Scarlett '), 'Portia & Scarlett');
  assert.equal(facetValueKey('PORTIA\u00a0& Scarlett'), facetValueKey('Portia & Scarlett'));
  assert.equal(mappedFacetValue('vendor', 'Portia\u00a0& Scarlett', rules), 'Portia & Scarlett');
  assert.deepEqual(expandMappedFacetValues('vendor', 'Portia\u00a0& Scarlett', rules), rules[0].sourceValues);
});
