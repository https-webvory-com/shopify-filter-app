import { checkRuleMatch, applyMerchandisingRules } from './app/services/merchandising.server.js';

const product = {
  id: 'gid://shopify/Product/15036601794931',
  title: 'Long Stretch Formal Off Shoulder Dress',
  variantPrices: [
    {
      id: 'gid://shopify/ProductVariant/63579552547187',
      price: 259,
      compareAtPrice: 518,
      option1: 'Red',
      option2: '10',
      option3: null,
      imageUrl: 'https://cdn.shopify.com/s/files/1/1109/3312/files/SC8175-red.jpg'
    }
  ]
};

const activeRule = {
  conditions: [
    { field: 'Color (product option)', operator: 'equals', value: 'red' }
  ]
};

const match = checkRuleMatch(product, activeRule.conditions[0]);
console.log('Match Result:', match);

const finalProducts = applyMerchandisingRules([product], activeRule, 'bestSelling');
console.log('Final Product merchandisingImage:', finalProducts[0].merchandisingImage);
