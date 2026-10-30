import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSize, mappedFacetValue, expandMappedFacetValues } from '../../app/utils/facetNormalization.js';
import { matchingAvailableVariants } from '../../app/utils/availableVariants.js';
import { createLoadingServer } from '../collection-loading/server.mjs';

test('apparel size aliases normalize while numeric sizes remain distinct', () => {
  assert.equal(canonicalSize(' xx-large '), '2XL');
  assert.equal(canonicalSize('2X'), '2XL');
  assert.equal(canonicalSize('Large'), 'L');
  assert.equal(canonicalSize('2'), null);
  assert.equal(mappedFacetValue('Size', 'large'), 'L');
  assert.ok(expandMappedFacetValues('Size', '2XL').includes('XXL'));
  const product = { options: [{ name: 'Size' }], variants: [{ available: true, option1: 'Extra Large' }] };
  assert.equal(matchingAvailableVariants(product, { Size: ['XL'] }).length, 1);
});

test('size facet counts use exact product union when a product has two aliases', async () => {
  const fixture = await createLoadingServer();
  try {
    fixture.state.noPins = true;
    fixture.state.noMerchandising = true;
    fixture.state.filterSettings = [{ id: 'size', filterType: 'option', filterKey: 'Size', label: 'Size', isEnabled: true, displayMode: 'List', config: {} }];
    for (const product of fixture.documents) {
      product.options.push({ name: 'Size', values: [] });
      product.variantPrices[0].option2 = null;
    }
    fixture.documents[0].options[1].values = ['L', 'Large'];
    fixture.documents[0].variantPrices[0].option2 = 'L';
    fixture.documents[1].options[1].values = ['Large'];
    fixture.documents[1].variantPrices[0].option2 = 'Large';
    fixture.documents[2].options[1].values = ['M'];
    fixture.documents[2].variantPrices[0].option2 = 'M';
    const url = new URL('http://fixture/api/filter?shop=headless-fixture.myshopify.com&collectionHandle=fixture&sortBy=manual&page=1&limit=25');
    const response = await fixture.load(new Request(url));
    assert.equal(response.status, 200);
    const body = await response.json();
    const sizes = body.facets.options.Size;
    assert.equal(sizes.find(item => item.value === 'L')?.count, 2, JSON.stringify(sizes));
    assert.equal(sizes.find(item => item.value === 'M')?.count, 1);
    assert.equal(sizes.some(item => item.value === 'Large'), false);
    url.searchParams.set('option_Size', 'L');
    const selected = await (await fixture.load(new Request(url))).json();
    assert.equal(selected.totalCount, 2);
  } finally { fixture.dispose(); }
});
