import test from 'node:test';
import assert from 'node:assert/strict';
import { instantSearchCard, INSTANT_SEARCH_INDEX_FIELDS } from '../../app/utils/instantSearchCard.js';

test('instant search keeps the storefront card and omits indexed internals', () => {
  const variant = { id: 'gid://shopify/ProductVariant/2', price: 149, available: true };
  const card = instantSearchCard({
    id: 'gid://shopify/Product/1', title: 'Blue dress', handle: 'blue-dress',
    images: ['https://cdn.example/blue.jpg'], variants: [variant],
    options: [{ name: 'Color', values: ['Blue'] }], priceMin: 149,
    selectedVariantId: variant.id, searchColorImage: 'https://cdn.example/blue.jpg',
    isPinned: true, cfpSearchFacetValues: ['internal'],
    cfpFilterFacts: { internal: true }, 'metafield_mm-google-shopping.color': 'blue',
    _formatted: { title: '<em>Blue</em> dress' }, variantPrices: [variant],
  });
  assert.deepEqual(card.variants, [variant]);
  assert.equal(card.selectedVariantId, variant.id);
  assert.equal(card.isPinned, true);
  assert.equal(card.priceMin, 149);
  for (const key of ['cfpSearchFacetValues', 'cfpFilterFacts', 'metafield_mm-google-shopping.color', '_formatted', 'variantPrices']) {
    assert.equal(Object.hasOwn(card, key), false);
  }
  assert.ok(INSTANT_SEARCH_INDEX_FIELDS.includes('variantPrices'));
  assert.ok(INSTANT_SEARCH_INDEX_FIELDS.includes('status'));
});
