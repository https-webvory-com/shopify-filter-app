import test from 'node:test';
import assert from 'node:assert/strict';
import { facetDisplayValue, facetValueKey, mappedFacetValue, expandMappedFacetValues, createFacetValueMapper } from '../../app/utils/facetNormalization.js';

test('facet aliases match Unicode spaces and retain a clean display label', () => {
  const rules = [{ filterType: 'vendor', targetValue: 'Portia & Scarlett', sourceValues: ['Portia\u00a0&\u00a0Scarlett', 'PORTIA & SCARLETT'] }];
  assert.equal(facetDisplayValue(' Portia\u00a0&\u00a0Scarlett '), 'Portia & Scarlett');
  assert.equal(facetValueKey('PORTIA\u00a0& Scarlett'), facetValueKey('Portia & Scarlett'));
  assert.equal(mappedFacetValue('vendor', 'Portia\u00a0& Scarlett', rules), 'Portia & Scarlett');
  assert.deepEqual(expandMappedFacetValues('vendor', 'Portia\u00a0& Scarlett', rules), rules[0].sourceValues);
});

test('compiled facet mapping preserves first rule, Unicode, case, sizes and exact unmapped tokens', () => {
  const rules = [
    {filterType:'Vendor',sourceValues:[' PORTIA\u00a0& SCARLETT ', 'VIP'],targetValue:' Portia & Scarlett '},
    {filterType:'vendor',sourceValues:['vip'],targetValue:'Later rule'},
    {filterType:'Size',sourceValues:['large'],targetValue:' Custom large '},
    {filterType:'tags',sourceValues:['Sale'],targetValue:''},
  ];
  const map = createFacetValueMapper(rules);
  for (const type of ['vendor','Vendor','Size','size','tags','Color'])
    for (const raw of ['Portia & Scarlett','VIP','vip',' LARGE ','xxl','Sale','sale',' Blue ','blue','']) {
      assert.equal(map(type,raw),mappedFacetValue(type,raw,rules));
      assert.equal(map(type,raw),mappedFacetValue(type,raw,rules),'cached lookups preserve the same token');
    }
  assert.equal(createFacetValueMapper([])('Color',' Blue '),' Blue ');
  assert.equal(createFacetValueMapper([])('Size','xxl'),'2XL');
});
