import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketRuleCountries, ruleAppliesToCountry } from '../../app/utils/marketRuleCountries.js';
import { normalizeCollectionWarmup, preparationKey } from '../../app/utils/collectionPreparation.js';
import { merchandisingInvalidationOptions } from '../../app/utils/merchandisingMarketInvalidation.js';

test('market rules keep all-country legacy behavior and honor explicit country targets', () => {
  assert.deepEqual(parseMarketRuleCountries(' gb, US,gb '), ['GB', 'US']);
  assert.deepEqual(parseMarketRuleCountries(''), []);
  assert.throws(() => parseMarketRuleCountries('GB, UK) { id'), /two-letter country/);
  assert.equal(ruleAppliesToCountry({ countries: [] }, 'US'), true);
  assert.equal(ruleAppliesToCountry({ countries: ['GB'] }, 'gb'), true);
  assert.equal(ruleAppliesToCountry({ countries: ['GB'] }, 'US'), false);
  assert.equal(ruleAppliesToCountry({ countries: ['GB'] }, ''), false);
});

test('country rule edits refresh the union of old and new markets; global rules refresh all',()=>{
  assert.deepEqual(merchandisingInvalidationOptions([{countries:['US']}],[{countries:['GB']}]),{kind:'market-rule',countries:['US','GB']});
  assert.equal(merchandisingInvalidationOptions([{countries:[]}],[{countries:['GB']}]),undefined);
  assert.equal(merchandisingInvalidationOptions([{countries:['US']}],[{countries:[]}]),undefined);
});

test('saved collection preparation keeps each shopper country in a distinct identity', () => {
  const uk = normalizeCollectionWarmup('merchant.myshopify.com',
    'https://fixture/api/filter?shop=merchant.myshopify.com&country=GB&collectionId=42&page=1', '42');
  const us = normalizeCollectionWarmup('merchant.myshopify.com',
    'https://fixture/api/filter?shop=merchant.myshopify.com&country=US&collectionId=42&page=1', '42');
  assert.equal(new URL(uk.url).searchParams.get('country'), 'GB');
  assert.equal(new URL(us.url).searchParams.get('country'), 'US');
  assert.notEqual(uk.url, us.url);
  assert.notEqual(preparationKey({shop:'merchant.myshopify.com',collectionId:'42',country:'GB'}),
    preparationKey({shop:'merchant.myshopify.com',collectionId:'42',country:'US'}));
});
