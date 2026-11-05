import test from 'node:test';
import assert from 'node:assert/strict';
import { pinnedProductMatchesAppliedIntent } from '../../app/utils/searchPinnedIntent.js';

test('explicit pins obey applied country price and size intent on one variant', () => {
  const product = { options: [{ name: 'Size' }], variants: [
    { option1: '16W', marketPrices: { US: { price: '125' } } },
    { option1: '12', marketPrices: { US: { price: '75' } } },
  ] };
  const parsed = { intent: { size: '16W', price: { min: null, max: 100, maxExclusive: true } },
    appliedIntent: { size: true, price: true, country: 'US' } };
  assert.equal(pinnedProductMatchesAppliedIntent(product, parsed), false);
  assert.equal(pinnedProductMatchesAppliedIntent({ ...product, variants: [
    { option1: '16W', marketPrices: { US: { price: '75' } } },
  ] }, parsed), true);
  assert.equal(pinnedProductMatchesAppliedIntent({ ...product, variants: [
    { option1: '16W', available: false, marketPrices: { US: { price: '75' } } },
  ] }, parsed), false);
  assert.equal(pinnedProductMatchesAppliedIntent(product, { ...parsed,
    appliedIntent: { size: false, price: false, country: 'US' } }), true);
});
