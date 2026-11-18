import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import {availablePins} from '../../app/utils/availablePins.server.js';
import {pinProductSearchFilter} from '../../app/utils/pinProductSearch.server.js';
const shop='owner.myshopify.com';
const plain=value=>JSON.parse(JSON.stringify(value));
const ui={react:{},'react-router':{},'@shopify/app-bridge-react':{},'@shopify/shopify-app-react-router/server':{boundary:{}},'../components/merchandising/PinSearchField':{},'../components/merchandising/PinProductImage':{},'../utils/reorderSearchPins.js':{}};

test('collection picker stock eligibility follows saved settings, retaining collection scope and exclusions',async()=>{
 for(const stockOnly of [true,false]){
  const calls=[];
  const prisma={filterGlobalSetting:{findUnique:async({where})=>{assert.equal(where.shop,shop);return {showOnlyInStock:stockOnly};}},product:{count:async args=>{calls.push(args);return stockOnly?391:482;},findMany:async args=>{calls.push(args);return [];}}};
  const route=await loadModule('app/routes/app.collections.pinning.$id.jsx',{
   ...ui,
   '../shopify.server':{authenticate:{admin:async()=>({session:{shop}})}},'../db.server':{default:prisma},
   '../utils/availablePins.server.js':{availablePins},'../utils/pinProductSearch.server':{pinProductSearchFilter},'../utils/pinProductImages.js':{catalogImageUrls:()=>[]},'../utils/pinProductImageFallbacks.server.js':{},
  });
  const response=await route.action({params:{id:'new'},request:new Request('https://app.test/app?shop=foreign.myshopify.com',{method:'POST',body:new URLSearchParams({intent:'search',q:'Dress',searchField:'title',collections:'["Formal"]',applyToAll:'false',excludedIds:'["pinned"]',skip:'9',stockOnly:'false'})})});
  assert.equal((await response.json()).totalCount,stockOnly?391:482);
  assert.deepEqual(plain(calls[0].where),plain(calls[1].where));
  const where=calls[1].where;assert.equal(where.shop,shop);assert.equal(!!where.variants,stockOnly);
  assert.deepEqual(plain(where.id),{notIn:['pinned']});assert.deepEqual(Array.from(where.collections.some.collection.title.in),['Formal']);
  assert.equal(calls[1].skip,9);assert.equal(calls[1].take,9);
 }
});

test('both saved pin editors retain unavailable products when allowed and never restore deleted products',async()=>{
 for(const section of ['collections','search'])for(const stockOnly of [true,false]){
  const pins=[{id:'sold-out',image:'saved.jpg'},{id:'in-stock'},{id:'deleted'}];
  const prisma={filterGlobalSetting:{findUnique:async({where})=>{assert.equal(where.shop,shop);return {showOnlyInStock:stockOnly};}},pinnedProductRule:{findFirst:async()=>({id:'rule',shop,ruleType:section==='search'?'search':'collection',products:pins,searchQueries:['prom'],applyToAll:false,collections:['Formal']})},product:{findMany:async({where})=>{assert.equal(where.shop,shop);assert.equal(!!where.variants,stockOnly);return (stockOnly?['in-stock']:['sold-out','in-stock']).map(id=>({id}));}}};
  const route=await loadModule(`app/routes/app.${section}.pinning.$id.jsx`,{
   ...ui,
   '../shopify.server':{authenticate:{admin:async()=>({session:{shop},admin:{graphql:async()=>({json:async()=>({data:{collections:{nodes:[]}}})})}})}},'../db.server':{default:prisma},
   '../utils/availablePins.server.js':{availablePins},'../utils/pinProductImageFallbacks.server.js':{pinProductImageFallbacks:async()=>({})},'../utils/pinProductImages.js':{},'../utils/pinProductSearch.server':{},'../services/shopCache.server':{},'../services/searchPicker.server.js':{},
  });
  const result=await route.loader({params:{id:'rule'},request:new Request('https://app.test/app')});
  assert.deepEqual(Array.from(result.rule.products,p=>p.id),stockOnly?['in-stock']:['sold-out','in-stock']);
 }
});
