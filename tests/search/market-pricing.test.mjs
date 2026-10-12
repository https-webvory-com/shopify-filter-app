import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile('extensions/theme-extension/assets/marketPricing.js','utf8');
function fixture({fail=false,compare=null}={}){
 const calls=[];const window={Shopify:{routes:{root:'/en/'},country:'IN',currency:{active:'INR'}}};
 const context={window,AbortController,setTimeout,clearTimeout,Date,console,fetch:async(url,opts)=>{calls.push(url);assert.equal(opts.credentials,'same-origin');if(fail)throw Error('offline');return {ok:true,json:async()=>({price_min:245000,price_max:299000,variants:[{id:42,price:245000,compare_at_price:compare}]})}}};
 vm.runInNewContext(source,context);return {window,calls,apply:window.cfpMarketPricing.apply};
}
const products=[{handle:'milk-cooler',priceMin:2500,priceMax:3000,variants:[{id:'gid://shopify/ProductVariant/42',price:2500,compareAtPrice:4000}]}];
test('Shopify storefront market prices replace estimates and stale compare-at prices by variant ID',async()=>{
 const f=fixture();const result=await f.apply(products);
 assert.equal(result[0].priceMin,2450);assert.equal(result[0].variants[0].price,2450);
 assert.equal(result[0].variants[0].compareAtPrice,null);assert.equal(result[0]._marketPricingApplied,true);
 assert.equal(products[0].priceMin,2500);assert.equal(products[0].variants[0].compareAtPrice,4000);
 assert.equal(f.calls[0],'/en/products/milk-cooler.js');
});
test('repeat requests share prices, but country changes fetch fresh storefront prices',async()=>{
 const f=fixture();await Promise.all([f.apply(products),f.apply(products)]);assert.equal(f.calls.length,1);
 f.window.Shopify.country='US';f.window.Shopify.currency.active='USD';await f.apply(products);assert.equal(f.calls.length,2);
});
test('failed price requests keep cards available and flag prices as unavailable',async()=>{
 const f=fixture({fail:true});const result=await f.apply(products);
 assert.equal(result.length,1);assert.equal(result[0]._marketPricingUnavailable,true);
 assert.equal(result[0]._marketPricingApplied,false);
 await f.apply(products);assert.equal(f.calls.length,2);
});
test('real Shopify compare-at prices are preserved',async()=>{
 const f=fixture({compare:300000});const result=await f.apply(products);assert.equal(result[0].variants[0].compareAtPrice,3000);
});

test('verified prices are available synchronously for repeat renders and isolated by market and customer context',async()=>{
 const f=fixture();assert.equal(f.window.cfpMarketPricing.peek(products[0]),null);
 await f.apply(products);
 const cached=f.window.cfpMarketPricing.peek(products[0]);
 assert.equal(cached.variants[0].price,2450);assert.equal(cached._marketPricingUnavailable,false);
 assert.equal(products[0].variants[0].price,2500);assert.equal(f.calls.length,1);
 f.window.Shopify.country='US';assert.equal(f.window.cfpMarketPricing.peek(products[0]),null);
 f.window.Shopify.country='IN';f.window.cfpCustomerTags='wholesale';assert.equal(f.window.cfpMarketPricing.peek(products[0]),null);
 f.window.cfpCustomerTags='';assert.equal(f.window.cfpMarketPricing.peek({...products[0],variants:[{id:'unknown'}]}),null);
});

test('prices are published individually while another product is still loading',async()=>{
 let releaseSlow;
 const published=[];
 const context={window:{Shopify:{routes:{root:'/'}}},AbortController,setTimeout,clearTimeout,Date,fetch:async url=>{
  if(url.includes('slow'))await new Promise(resolve=>{releaseSlow=resolve;});
  return {ok:true,json:async()=>({price_min:1000,price_max:1000,variants:[]})};
 }};
 vm.runInNewContext(source,context);
 const pending=context.window.cfpMarketPricing.apply([{handle:'fast'},{handle:'slow'}],(product,index)=>published.push([product.handle,index,product.priceMin]));
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(published,[['fast',0,10]]);
 releaseSlow();await pending;
 assert.deepEqual(published,[['fast',0,10],['slow',1,10]]);
});
