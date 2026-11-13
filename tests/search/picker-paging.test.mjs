import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import {pinProductSearchFilter} from '../../app/utils/pinProductSearch.server.js';
import {catalogImageUrls} from '../../app/utils/pinProductImages.js';
const shop='picker.myshopify.com',gid=id=>'gid://shopify/Product/'+id;
async function fixture({fallback=false}={}){
 const calls=[],native=[],engine=[];
 const service=await loadModule('app/services/searchPicker.server.js',{
  '../db.server':{default:{product:{findMany:async args=>{calls.push(args);if(!args.where.id)return Array.from({length:49958},(_,i)=>({id:gid(i+1)}));assert.ok(args.where.id.in.length<=9,'database hydration is limited to one visible page');return args.where.id.in.map(id=>({id,title:'Dress '+id,images:['https://cdn.shopify.com/dress.jpg']}));}}}},
  './queryParser.server.js':{parseQuery:async()=>({colorFilter:'option_Color = "Red"'})},
  './nativeSearchPage.server.js':{rankNativeSearchPage:async args=>{native.push(args);return fallback?null:{products:Array.from({length:9},(_,i)=>({id:String((args.page-1)*9+i+1)})),total:49958};}},
  './semanticSearch.server':{semanticSearch:async(query,options)=>{engine.push({query,options});return {hits:Array.from({length:9},(_,i)=>({id:String(i+1)})),totalHits:49958};}},
  '../utils/pinProductSearch.server':{pinProductSearchFilter},'../utils/pinProductImages.js':{catalogImageUrls},
 });return {service,calls,native,engine};
}
test('49,958 matching products use storefront pagination and only nine database IDs',async()=>{
 const f=await fixture(),result=await f.service.searchPickerPage(shop,'promD',{skip:9});
 assert.equal(result.totalCount,49958);assert.equal(result.products.length,9);assert.equal(f.native[0].page,2);assert.equal(f.native[0].limit,9);
 assert.equal(f.native[0].query,'promD');assert.ok(f.native[0].options._cfpSearchSurface);assert.ok(f.native[0].options.filter.includes('available = true'));
 assert.ok(f.native[0].options.filter.includes('option_Color = "Red"'));assert.equal(f.calls.length,1);assert.equal(f.calls[0].where.shop,shop);assert.equal(f.calls[0].where.variants.some.available,true);
});
test('broad title searches do not put their 49,958 matches into SQL bind variables',async()=>{
 const f=await fixture(),result=await f.service.searchPickerPage(shop,'promD',{query:'dress',searchField:'title'});
 assert.equal(result.products.length,9);assert.equal(f.calls[0].where.title.contains,'dress');assert.equal(f.calls[0].where.id,undefined);
 assert.equal(f.calls[1].where.id.in.length,9);assert.ok(f.native[0].options.filter.some(filter=>filter.startsWith('id IN ')));
});
test('stores without native projections still request a single bounded search page',async()=>{
 const f=await fixture({fallback:true}),result=await f.service.searchPickerPage(shop,'promD',{skip:18});
 assert.equal(result.products.length,9);assert.equal(f.engine[0].options.offset,18);assert.equal(f.engine[0].options.limit,9);assert.equal(f.engine[0].options.page,undefined);assert.equal(f.calls[0].where.id.in.length,9);
});
test('bad pagination is rejected before database or engine work',async()=>{
 const f=await fixture();await assert.rejects(f.service.searchPickerPage(shop,'dress',{skip:-1}),/Invalid/);assert.equal(f.calls.length,0);assert.equal(f.native.length,0);
});
test('picker resource failures return a recoverable response and never accept save intents',async()=>{
 let searches=0;
 const route=await loadModule('app/routes/app.product-picker.jsx',{
  '../shopify.server':{authenticate:{admin:async()=>({session:{shop}})}},'../services/searchPicker.server.js':{searchPickerPage:async()=>{searches++;throw Object.assign(Error('database failure'),{code:'P2035'});}},
  '../services/searchCollectionPicker.server.js':{},'../utils/pinProductSearch.server':{},'../db.server':{default:{}},
 });
 const request=values=>new Request('https://app/app/product-picker?scope=search',{method:'POST',body:new URLSearchParams(values)});
 let response=await route.action({request:request({intent:'search',targetQueries:'["promD"]',q:'dress'})});assert.equal(response.status,200);const body=await response.json();assert.equal(body.targetQueryKey,'["promD"]');assert.match(body.error,/retry/i);assert.equal(body.products.length,0);
 response=await route.action({request:request({intent:'save'})});assert.equal(response.status,400);assert.equal(searches,1);
});
