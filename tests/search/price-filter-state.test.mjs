import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = (await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js', 'utf8')).replace(/\r\n/g, '\n');
const priceQuery = source.slice(source.indexOf('      // Price range\n'), source.indexOf('      // Basic arrays'));
function request(activeFilters, maxPriceLimit) {
  const queryParams = new URLSearchParams();
  vm.runInNewContext(priceQuery, {activeFilters, maxPriceLimit, queryParams});
  return queryParams;
}

test('selected price cap survives facet bounds changing after a fabric selection', () => {
  const selection = {minPrice: 90, maxPrice: 200};
  for (const facetMaximum of [769, 200, 150]) {
    const params = request(selection, facetMaximum);
    assert.equal(params.get('minPrice'), '90');
    assert.equal(params.get('maxPrice'), '200');
  }
});

test('unselected price range adds no price constraints', () => {
  const params = request({minPrice: 0, maxPrice: 999999}, 200);
  assert.equal(params.has('minPrice'), false);
  assert.equal(params.has('maxPrice'), false);
});
