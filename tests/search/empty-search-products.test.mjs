import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import * as schema from '../../app/utils/searchSettings.js';
import * as color from '../../app/utils/searchColor.js';
import {requiresCustomSearchIndex} from '../../app/utils/searchConfiguration.js';
const shop='one.myshopify.com',gid=id=>'gid://shopify/Product/'+id;
const pin=id=>({id:gid(id),title:'Product '+id,image:''});

test('empty-search products preserve selected order and validate IDs, limits and images',()=>{
  const validate=products=>schema.validateSearchSettings({...schema.DEFAULT_SEARCH_SETTINGS,emptySearchProducts:products});
  assert.deepEqual(validate([pin(2),pin(1)]).emptySearchProducts,[pin(2),pin(1)]);
  assert.equal(requiresCustomSearchIndex(validate([pin(2),pin(1)])),false);
  for(const products of [[pin(1),pin(1)],Array.from({length:21},(_,i)=>pin(i)),[{...pin(1),id:'other'}],[{...pin(1),image:'javascript:alert(1)'}],[{...pin(1),image:'https://user:pass@example.com/a.png'}]])assert.throws(()=>validate(products));
  const old={...schema.DEFAULT_SEARCH_SETTINGS};delete old.emptySearchProducts;
  assert.deepEqual(schema.validateSearchSettings(old).emptySearchProducts,[]);
});

test('picker and saved selections require active products from the authenticated store',async()=>{
  const calls=[];
  const service=await loadModule('app/services/searchCollectionPicker.server.js',{'../db.server':{default:{product:{findMany:async options=>{calls.push(options);return [{id:gid(1),title:'Snowboard',images:['https://example.com/a.jpg']}];}}}}});
  const page=await service.listSearchProducts(shop,{query:'snow'});
  assert.equal(calls[0].where.shop,shop);assert.deepEqual(Array.from(calls[0].where.status.in),['ACTIVE','active']);
  assert.equal(calls[0].take,21);assert.equal(page.products[0].image,'https://example.com/a.jpg');
  assert.equal((await service.validateSelectedSearchProducts(shop,[pin(1)]))[0].title,'Snowboard');
  assert.equal(calls[1].where.shop,shop);assert.deepEqual(Array.from(calls[1].where.id.in),[gid(1)]);
  await assert.rejects(service.validateSelectedSearchProducts(shop,[pin(2)]),/no longer active/);
  await assert.rejects(service.listSearchProducts(shop,{query:'a'.repeat(121)}),/Invalid/);
});

async function routeFixture({pins=[pin(2),pin(1)],stockOnly=false,layout='fullscreen'}={}){
  const queries=[];
  const docs=[{id:'1',shop,status:'ACTIVE',available:true,title:'First',variantPrices:[]},{id:'2',shop,status:'ACTIVE',available:false,title:'Second',variantPrices:[]},{id:'3',shop,status:'ACTIVE',available:true,title:'Automatic',variantPrices:[]},{id:'4',shop:'other.myshopify.com',status:'ACTIVE',available:true,title:'Other shop',variantPrices:[]}];
  const route=await loadModule('app/routes/api.search.jsx',{
    'react-router':{data:(value,init)=>Response.json(value,init)},'../db.server':{default:{}},
    '../utils/searchColor.js':color,
    '../services/queryParser.server.js':{parseQuery:async()=>null},'../utils/spellingCorrection.js':{spellingCorrection:()=>null},'../utils/searchSuggestions.js':{buildSearchSuggestions:()=>[]},
    '../services/merchandising.server':{getActivePinningRuleForSearch:async()=>null,getActiveRuleForSearch:async()=>null},
    '../services/searchRanking.server.js':{},'../services/meiliClient.server':{default:{}},'../services/filterSettings.server':{},
    '../services/shopCache.server':{getCached:async(key,read)=>key.startsWith('globalSettings')?{showOnlyInStock:stockOnly}:read()},
    '../services/rateLimiter.server':{rateLimit:async()=>true},'../services/suggestionBlacklist.server.js':{getActiveSuggestionBlacklist:async()=>[]},
    '../services/searchIndex.server.js':{getSearchIndexContext:async()=>({uid:'products',settings:{...schema.DEFAULT_SEARCH_SETTINGS,instantLayout:layout,emptySearchProducts:pins}}),configuredSuggestions:async()=>[]},
    '../services/semanticSearch.server':{semanticSearch:async(query,options)=>{queries.push({query,options});const filter=options.filter.find(f=>f.startsWith('id IN '));const ids=filter?JSON.parse(filter.slice(6)):null;return {hits:docs.filter(doc=>doc.shop===shop&&doc.status==='ACTIVE'&&(!stockOnly||doc.available)&&(!ids||ids.includes(doc.id)))};}},
  });
  return {queries,read:async(q='',limit=6)=>{
    const response=await route.loader({request:new Request('https://fixture/api/search?shop='+shop+'&q='+encodeURIComponent(q)+'&limit='+limit)});
    assert.equal(response.status,200);return response.json();
  }};
}
test('empty search returns only chosen products in saved order and respects the card limit',async()=>{
  const fixture=await routeFixture();
  const result=await fixture.read('   ',1);
  assert.deepEqual(result.products.map(p=>p.id),[gid(2)]);assert.equal(result.pinnedCount,1);
  const filters=fixture.queries[0].options.filter;assert.ok(filters.includes("shop = '"+shop+"'"));assert.ok(filters.includes("status = 'ACTIVE'"));
  assert.deepEqual(JSON.parse(filters.find(f=>f.startsWith('id IN ')).slice(6)),['2','1']);
  assert.deepEqual((await fixture.read()).products.map(p=>p.id),[gid(2),gid(1)]);
});
test('typed searches and automatic defaults are unaffected; unavailable pins respect stock settings',async()=>{
  const fixture=await routeFixture();
  const typed=await fixture.read('snow');assert.equal(typed.pinnedCount,0);assert.equal(typed.products.length,3);assert.ok(!fixture.queries[0].options.filter.some(f=>f.startsWith('id IN ')));
  const automatic=await routeFixture({pins:[]});assert.equal((await automatic.read()).products.length,3);
  const compact=await routeFixture({layout:'compact'});const compactResult=await compact.read();assert.equal(compactResult.products.length,3);assert.equal(compactResult.pinnedCount,0);assert.ok(!compact.queries[0].options.filter.some(f=>f.startsWith('id IN ')));
  const stock=await routeFixture({stockOnly:true});assert.deepEqual((await stock.read()).products.map(p=>p.id),[gid(1)]);assert.ok(stock.queries[0].options.filter.includes('available = true'));
  const missing=await routeFixture({pins:[pin(99)]});assert.deepEqual((await missing.read()).products,[]);
});
