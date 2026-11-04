import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
const helper=source.slice(source.indexOf('  function updateMarketCardPrice('),source.indexOf('  async function renderProducts('));
function fixture(templateName = 'collection', settings = {}) {
 const row={children:[],replaceChildren(){this.children=[];},append(e){this.children.push(e);}};
 const image={children:[],append(e){this.children.push(e);}};
 let href='https://shop.test/products/dress?variant=2';
 const card={dataset:{},querySelector(selector){if(selector.includes('price-row'))return row;if(selector.includes('__link'))return {href};if(selector.includes('__image-container'))return image;return null;},querySelectorAll(){return [];}};
 const context={templateName,globalSettings:{},activeFilters:{options:{}},priceSortedVariant:()=>null,window:{Shopify:{currency:{active:'INR'}},cfpSearchSettings:settings},location:{origin:'https://shop.test'},URL,Intl,document:{createElement:()=>({style:{},textContent:''})}};
 vm.runInNewContext(helper,context);
 return {card,row,image,update:context.window.cfpUpdateMarketCardPrice,setCurrency:code=>{context.window.Shopify.currency.active=code;},select:id=>{href='https://shop.test/products/dress?variant='+id;}};
}
const product={priceMin:10,tags:['show compare price'],available:true,variants:[{id:'gid://shopify/ProductVariant/1',price:10,compareAtPrice:null},{id:'gid://shopify/ProductVariant/2',price:20,compareAtPrice:30}]};

test('late prices follow the currently selected variant and market currency',()=>{
 const f=fixture();f.update(f.card,product);
 assert.equal(f.row.children[0].textContent,'Rs. 20.00 INR');
 assert.equal(f.row.children[1].textContent,'Rs. 30.00 INR');
 f.select('1');f.update(f.card,f.card._cfpMarketProduct);
 assert.equal(f.row.children[0].textContent,'Rs. 10.00 INR');assert.equal(f.row.children.length,1);
 for(const [currency,expected]of [['USD','$10.00'],['GBP','£10.00'],['JPY','¥10'],['INR','Rs. 10.00 INR']]){
  f.setCurrency(currency);f.update(f.card,f.card._cfpMarketProduct);assert.equal(f.row.children[0].textContent,expected);
 }
});

test('removed cards and unavailable prices cannot replace displayed market prices',()=>{
 const f=fixture();f.update(null,product);f.update(f.card,{...product,_marketPricingUnavailable:true});
 assert.equal(f.row.children.length,0);
});

test('compare-at and image sale badge follow their separate live theme tags',()=>{
 for(const tags of [[],['Clearance']]){
   const f=fixture();f.update(f.card,{...product,tags});
   assert.equal(f.row.children.length,1);
   assert.equal(f.image.children.length,0);
 }
 const compareOnly=fixture();compareOnly.update(compareOnly.card,product);
 assert.equal(compareOnly.row.children.length,2);
 assert.equal(compareOnly.image.children.length,0);
 const sale=fixture();sale.update(sale.card,{...product,tags:['Sale']});
 assert.equal(sale.row.children.length,2);
 assert.equal(sale.image.children.length,1);
 const noDiscount=fixture();noDiscount.update(noDiscount.card,{...product,tags:['Sale'],variants:product.variants.map(v=>({...v,compareAtPrice:null}))});
 assert.equal(noDiscount.row.children.length,1);
 assert.equal(noDiscount.image.children.length,1);
});

test('late market price updates respect search sale visibility without changing collection badges',()=>{
 for(const [template,showSale,count] of [['search',false,0],['search',true,1],['collection',false,1]]) {
   const f=fixture(template,{showSale});f.update(f.card,{...product,tags:['Sale']});
   assert.equal(f.image.children.length,count);
   assert.equal(f.row.children.length,2,'Hiding sale badge must preserve accurate compare-at prices');
 }
});
