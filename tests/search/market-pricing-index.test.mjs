import test from 'node:test';
import assert from 'node:assert/strict';
import { marketCountries, contextualPricingFields, variantMarketPrices, productMarketPriceRanges,
  productMarketPriceIndexFields, variantPriceRange } from '../../app/utils/marketPricingIndex.js';
import { searchIndexProjection } from '../../app/utils/searchIndexProjection.js';

test('market pricing fields are deduplicated, deterministic and safe for Shopify GraphQL',()=>{
  assert.deepEqual(marketCountries(['gb','US','GB']),['GB','US']);
  assert.match(contextualPricingFields(['GB']),/cfpMarket_GB: contextualPricing\(context: \{country: GB\}\)/);
  assert.throws(()=>contextualPricingFields(['GB) { id']),/Invalid market country/);
});

test('shared search documents expose only complete country price ranges', () => {
  const variants = [
    { price: 160, marketPrices: { US: { price: 149, currency: 'USD' }, GB: { price: 115, currency: 'GBP' } } },
    { price: 170, marketPrices: { US: { price: 159, currency: 'USD' } } },
  ];
  const fields = productMarketPriceIndexFields(variants);
  assert.deepEqual(fields, { marketPriceMin_US: 149, marketPriceMax_US: 159, marketPriceCurrency_US: 'USD' });
  const projected = searchIndexProjection({ id: '1', shop: 'one.myshopify.com', variantPrices: variants });
  assert.equal(projected.marketPriceMin_US, 149);
  assert.equal(projected.marketPriceMin_GB, undefined);
});

test('a missing or inconsistent country price cannot enter a complete market range',()=>{
  const gb={price:{amount:'115.00',currencyCode:'GBP'},compareAtPrice:{amount:'140.00',currencyCode:'GBP'}};
  const us={price:{amount:'149.00',currencyCode:'USD'},compareAtPrice:null};
  const first=variantMarketPrices({cfpMarket_GB:gb,cfpMarket_US:us},['GB','US']);
  assert.deepEqual(first.GB,{price:115,compareAtPrice:140,currency:'GBP'});
  assert.deepEqual(variantMarketPrices({cfpMarket_GB:gb},['GB','US']),{GB:{price:115,compareAtPrice:140,currency:'GBP'}});
  assert.deepEqual(variantMarketPrices({cfpMarket_GB:{...gb,compareAtPrice:{amount:'140',currencyCode:'USD'}}},['GB']).GB,
    {price:115,compareAtPrice:null,currency:'GBP'});
  assert.deepEqual(variantMarketPrices({cfpMarket_GB:{...gb,compareAtPrice:{amount:'-175600',currencyCode:'GBP'}}},['GB']).GB,
    {price:115,compareAtPrice:null,currency:'GBP'});
  const ranges=productMarketPriceRanges([{marketPrices:first},{marketPrices:{GB:{price:125,currency:'GBP'},US:{price:159,currency:'USD'}}}],['GB','US']);
  assert.deepEqual(ranges,{GB:{min:115,max:125,currency:'GBP'},US:{min:149,max:159,currency:'USD'}});
  assert.deepEqual(productMarketPriceRanges([{marketPrices:first},{marketPrices:{US:{price:159,currency:'USD'}}}],['GB','US']),
    {US:{min:149,max:159,currency:'USD'}});
});

test('market price sorting uses the cheapest available variant while retaining the full price range',()=>{
  const variants=[
    {price:20,available:false,marketPrices:{IN:{price:2000,currency:'INR'}}},
    {price:26,available:true,marketPrices:{IN:{price:2600,currency:'INR'}}},
    {price:24,available:true,marketPrices:{IN:{price:2400,currency:'INR'}}},
  ];
  const projected=searchIndexProjection({id:'1',shop:'one.myshopify.com',variantPrices:variants});
  assert.equal(projected.marketPriceMin_IN,2000);
  assert.equal(projected.marketAvailablePriceMin_IN,2400);
  assert.equal(projected.availablePriceMin,24);
  assert.equal(projected.availablePriceMax,26);
  assert.equal(projected.marketAvailablePriceMax_IN,2600);
});

test('base collection sort price ignores sold-out variants when a purchasable variant exists',()=>{
  const variants=[
    {price:102,availableForSale:true},
    {price:36,availableForSale:false},
    {price:36,availableForSale:false},
  ];
  assert.deepEqual(variantPriceRange(variants),{min:102,max:102});
  assert.deepEqual(variantPriceRange([{price:36,availableForSale:false},{price:102,availableForSale:false}]),{min:36,max:102});
  assert.deepEqual(variantPriceRange([{price:36},{price:102}]),{min:36,max:102});
});
