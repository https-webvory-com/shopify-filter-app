import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
const helper=source.slice(source.indexOf('  function updateMarketCardPrice('),source.indexOf('  async function renderProducts('));
function fixture() {
 const row={children:[],replaceChildren(){this.children=[];},append(e){this.children.push(e);}};
 let href='https://shop.test/products/dress?variant=2';
 const card={querySelector(selector){if(selector.includes('price-row'))return row;if(selector.includes('__link'))return {href};return null;}};
 const context={window:{Shopify:{currency:{active:'INR'}}},location:{origin:'https://shop.test'},URL,Intl,document:{createElement:()=>({style:{},textContent:''})}};
 vm.runInNewContext(helper,context);
 return {card,row,update:context.window.cfpUpdateMarketCardPrice,select:id=>{href='https://shop.test/products/dress?variant='+id;}};
}
const product={priceMin:10,tags:['sale'],available:true,variants:[{id:'gid://shopify/ProductVariant/1',price:10,compareAtPrice:null},{id:'gid://shopify/ProductVariant/2',price:20,compareAtPrice:30}]};

test('late prices follow the currently selected variant and market currency',()=>{
 const f=fixture();f.update(f.card,product);
 assert.equal(f.row.children[0].textContent,'₹20.00');
 assert.equal(f.row.children[1].textContent,'₹30.00');
 f.select('1');f.update(f.card,f.card._cfpMarketProduct);
 assert.equal(f.row.children[0].textContent,'₹10.00');assert.equal(f.row.children.length,1);
});

test('removed cards and unavailable prices cannot replace displayed market prices',()=>{
 const f=fixture();f.update(null,product);f.update(f.card,{...product,_marketPricingUnavailable:true});
 assert.equal(f.row.children.length,0);
});
