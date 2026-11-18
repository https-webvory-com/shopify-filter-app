import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile('extensions/theme-extension/assets/marketPricing.js','utf8');
function fixture({fail=false,compare=null}={}){
 const calls=[];const window={Shopify:{routes:{root:'/en/'},country:'IN',currency:{active:'INR'}}};
 const context={window,AbortController,setTimeout,clearTimeout,Date,console,fetch:async(url,opts)=>{calls.push(url);assert.equal(opts.credentials,'same-origin');if(fail)throw Error('offline');const amount=window.Shopify.currency.active==='USD'?2800:245000;return {ok:true,json:async()=>({price_min:amount,price_max:window.Shopify.currency.active==='USD'?3500:299000,variants:[{id:42,price:amount,compare_at_price:compare}]})}}};
 vm.runInNewContext(source,context);return {window,calls,apply:window.cfpMarketPricing.apply};
}
const products=[{handle:'milk-cooler',priceMin:2500,priceMax:3000,variants:[{id:'gid://shopify/ProductVariant/42',price:2500,compareAtPrice:4000}]}];

test('saved country prices render without per-product Shopify requests and reject another country',async()=>{
 const f=fixture(),calls=[];
 const product={...products[0],pricingContext:{country:'IN',currency:'INR',source:'saved'}};
 const priced=await f.apply([product],p=>calls.push(p.priceMin));assert.equal(f.calls.length,0);assert.equal(priced[0]._marketPricingApplied,true);assert.deepEqual(calls,[2500]);
 f.window.Shopify.country='US';f.window.Shopify.currency.active='USD';await f.apply([product]);assert.equal(f.calls.length,1);
});

test('a page reuses saved DB prices in one batch instead of refetching every product from Shopify',async()=>{
 const calls=[],window={Shopify:{shop:'owner.myshopify.com',country:'IN',currency:{active:'INR'}}};
 const context={window,URLSearchParams,AbortController,setTimeout,clearTimeout,Date,fetch:async url=>{
  calls.push(url);assert.match(url,/\/api\/market-prices\?/);return {ok:true,json:async()=>({country:'IN',currency:'INR',products:[{id:'1',priceMin:900,priceMax:900,variants:[{id:'11',price:900,available:true}],pricingContext:{country:'IN',currency:'INR',source:'saved'}}]})};
 }};
 vm.runInNewContext(source,context);const result=await window.cfpMarketPricing.apply([{id:'1',handle:'dress',variants:[{id:'11',imageUrl:'kept.jpg'}]}]);
 assert.equal(calls.length,1);assert.equal(result[0].variants[0].price,900);assert.equal(result[0].variants[0].imageUrl,'kept.jpg');assert.equal(result[0]._marketPricingUnavailable,false);
});

test('concurrent and repeated sorts share saved price reads; a changed variant refreshes only its product',async()=>{
 const calls=[],window={Shopify:{shop:'owner.myshopify.com',country:'IN',currency:{active:'INR'}}};
 let release,variant='11';
 const held=new Promise(resolve=>release=resolve);
 const context={window,URLSearchParams,AbortController,setTimeout,clearTimeout,Date,fetch:async url=>{
  calls.push(url);assert.match(url,/\/api\/market-prices\?/);await held;
  return {ok:true,json:async()=>({country:'IN',currency:'INR',products:[{id:'1',priceMin:900,priceMax:900,variants:[{id:variant,price:900,available:true}],pricingContext:{country:'IN',currency:'INR',source:'saved'}}]})};
 }};
 vm.runInNewContext(source,context);
 const product={id:'1',handle:'dress',variants:[{id:'11'}]};
 const first=window.cfpMarketPricing.apply([product]),second=window.cfpMarketPricing.apply([product]);
 assert.equal(calls.length,1);release();await Promise.all([first,second]);
 await window.cfpMarketPricing.apply([product]);assert.equal(calls.length,1);
 variant='12';const changed=await window.cfpMarketPricing.apply([{...product,variants:[{id:'12'}]}]);
 assert.equal(calls.length,2);assert.equal(changed[0].variants[0].price,900);
 assert.equal(new URL(calls[1]).searchParams.get('ids'),'1');
});

test('known saved prices publish before another product finishes a slow background read',async()=>{
 const published=[],window={Shopify:{shop:'owner.myshopify.com',country:'IN',currency:{active:'INR'}}};
 let release;const held=new Promise(resolve=>release=resolve);
 const context={window,URLSearchParams,AbortController,setTimeout,clearTimeout,Date,fetch:async()=>{
  await held;return {ok:true,json:async()=>({country:'IN',currency:'INR',products:[{id:'2',priceMin:20,priceMax:20,variants:[{id:'22',price:20}],pricingContext:{country:'IN',currency:'INR',source:'saved'}}]})};
 }};
 vm.runInNewContext(source,context);
 const pending=window.cfpMarketPricing.apply([{id:'1',priceMin:10,variants:[{id:'11',price:10}],pricingContext:{country:'IN',currency:'INR',source:'saved'}},{id:'2',variants:[{id:'22'}]}],product=>published.push(product.id));
 assert.deepEqual(published,['1']);release();await pending;assert.deepEqual(published,['1','2']);
});
test('Shopify storefront market prices replace estimates and stale compare-at prices by variant ID',async()=>{
 const f=fixture();const result=await f.apply(products);
 assert.equal(result[0].priceMin,2450);assert.equal(result[0].variants[0].price,2450);
 assert.equal(result[0].variants[0].compareAtPrice,null);assert.equal(result[0]._marketPricingApplied,true);
 assert.equal(products[0].priceMin,2500);assert.equal(products[0].variants[0].compareAtPrice,4000);
 assert.equal(f.calls[0],'/en/products/milk-cooler.js');
});
test('repeat requests share prices, but country changes fetch fresh storefront prices',async()=>{
 const f=fixture();await Promise.all([f.apply(products),f.apply(products)]);assert.equal(f.calls.length,1);
 f.window.Shopify.country='US';f.window.Shopify.currency.active='USD';const changed=await f.apply(products);assert.equal(f.calls.length,2);assert.equal(changed[0].variants[0].price,28);
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
