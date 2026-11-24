import test from 'node:test';
import assert from 'node:assert/strict';
import {savedMarketProduct,hydrateSavedMarketPrices} from '../../app/utils/savedMarketPricing.js';
import {loadModule} from './helpers/search-ranking.mjs';

test('existing country prices are reused without mixing currencies or changing the source dataset',()=>{
 const product={id:'1',priceMin:10,variants:[{id:'v1',price:10,marketPrices:{IN:{price:900,currency:'INR',compareAtPrice:1000}}},{id:'v2',price:20,marketPrices:{IN:{price:1800,currency:'INR'}}}]};
 const priced=savedMarketProduct(product,'IN');assert.equal(priced.priceMin,900);assert.equal(priced.variants[0].price,900);assert.equal(priced.pricingContext.currency,'INR');assert.equal(product.variants[0].price,10);assert.equal('marketPrices' in priced.variants[0],false);
 assert.equal(savedMarketProduct(product,'GB').pricingContext,undefined);
 product.variants[1].marketPrices.IN.currency='USD';assert.equal(savedMarketProduct(product,'IN').pricingContext,undefined);
});

test('background price reconciliation reads only the visible products and the authenticated shop',async()=>{
 const products=[{id:'gid://shopify/Product/1',variantPrices:[{id:'11',marketPrices:{IN:{price:1,currency:'INR'}}}]},{id:'2',variantPrices:[{id:'22'}]}];let query;
 await hydrateSavedMarketPrices(products,{findMany:async q=>{query=q;return [{productId:'gid://shopify/Product/1',id:'gid://shopify/ProductVariant/11',marketPrices:{IN:{price:20,currency:'INR'}}},{productId:'gid://shopify/Product/2',id:'gid://shopify/ProductVariant/22',marketPrices:{IN:{price:30,currency:'INR'}}}];}},'owner.myshopify.com','IN');
 assert.deepEqual(query.where.productId.in,['gid://shopify/Product/1','gid://shopify/Product/2']);assert.equal(query.where.product.shop,'owner.myshopify.com');assert.equal(products[0].variantPrices[0].marketPrices.IN.price,20);assert.equal(products[1].variantPrices[0].marketPrices.IN.price,30);
});

test('visible saved prices can project only the requested country without weakening tenant and product ownership',async()=>{
 const products=[{id:'1',variantPrices:[{id:'11',marketPrices:{IN:{price:1},GB:{price:2}}},{id:'12',marketPrices:{IN:{price:3}}},{id:'13',marketPrices:{IN:{price:4}}}]}];let query;
 await hydrateSavedMarketPrices(products,{findMany:()=>{throw Error('No complete market JSON read');}},'owner.myshopify.com','IN',{database:{$queryRaw:async value=>{
  query=value;return [{id:'11',productId:'gid://shopify/Product/1',marketPrices:{IN:{price:100,currency:'INR'}}},{id:'12',productId:'gid://shopify/Product/1',marketPrices:{IN:null}},{id:'13',productId:'gid://shopify/Product/2',marketPrices:{IN:{price:900}}}];
 }}});
 assert.match(query.text,/jsonb_build_object/);assert.match(query.text,/JOIN "Product"/);assert.match(query.text,/jsonb_typeof/);
 assert.ok(query.values.includes('owner.myshopify.com'));assert.ok(query.values.includes('gid://shopify/Product/1'));assert.ok(query.values.includes('IN'));
 assert.equal(products[0].variantPrices[0].marketPrices.IN.price,100);assert.equal(products[0].variantPrices[0].marketPrices.GB.price,2);
 assert.equal(products[0].variantPrices[1].marketPrices.IN,null);assert.equal(products[0].variantPrices[2].marketPrices.IN.price,4);
});

test('unavailable country projection retains the original saved-price read',async()=>{
 const products=[{id:'1',variantPrices:[{id:'11'}]}];let reads=0;
 await hydrateSavedMarketPrices(products,{findMany:async()=>{reads++;return [{id:'11',productId:'gid://shopify/Product/1',marketPrices:{IN:{price:100,currency:'INR'}}}];}},'owner.myshopify.com','IN',{database:{$queryRaw:async()=>{throw Error('Unavailable');}}});
 assert.equal(reads,1);assert.equal(products[0].variantPrices[0].marketPrices.IN.price,100);
});

test('price sorting recognizes saved country fields without a coverage scan or revision proof',async()=>{
 const calls=[];
 const service=await loadModule('app/services/marketPriceCoverage.server.js',{
  '../db.server.js':{default:{$queryRaw:()=>{throw Error('No catalog scan');}}},'./redis.server.js':{default:{get:()=>{throw Error('No store revision read');}}},
  './shopCache.server.js':{getCached:async(_key,read)=>read()},
  './meiliClient.server.js':{default:{index:()=>({getSettings:async()=>({filterableAttributes:['marketAvailablePriceMin_IN'],sortableAttributes:['marketAvailablePriceMin_IN']}),search:async()=>{calls.push('scan');throw Error('No product scan');}})}},
  '../utils/shopCacheInvalidation.js':{productRevisionKey:()=>''},
 });
 const filter=['shop = "owner.myshopify.com"','collections = "1"','available = true'];
 assert.equal(await service.marketPriceScopeReady('IN',{filter,stockOnly:true}),true);assert.equal(calls.length,0);
 assert.equal(await service.marketPriceScopeReady('IN',{filter:[],stockOnly:true}),false);
});

test('saved page-price endpoint reads at most 40 explicit IDs and never fetches a catalog or writes data',async()=>{
 let query;
 const route=await loadModule('app/routes/api.market-prices.jsx',{
  '../db.server':{default:{product:{findMany:async q=>{query=q;return [{id:'gid://shopify/Product/1',variants:[{id:'11',available:true,marketPrices:{IN:{price:100,currency:'INR'}}}]}];}}}},
  '../services/rateLimiter.server':{rateLimit:async()=>true},
 });
 const base='https://api.test/api/market-prices?shop=owner.myshopify.com&country=IN&currency=INR&ids=';
 const response=await route.loader({request:new Request(base+'1,2')});const body=await response.json();
 assert.equal(response.status,200);assert.equal(body.products[0].variants[0].price,100);assert.deepEqual(Array.from(query.where.id.in),['gid://shopify/Product/1','gid://shopify/Product/2']);assert.equal(query.where.shop,'owner.myshopify.com');
 assert.equal((await route.loader({request:new Request(base+Array.from({length:41},(_,i)=>i+1).join(','))})).status,400);
});
