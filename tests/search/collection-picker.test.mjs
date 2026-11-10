import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import * as schema from '../../app/utils/searchSettings.js';

test('saved collection picker searches only the authenticated shop with bounded pagination and product thumbnails',async()=>{
  const calls=[];
  const rows=Array.from({length:41},(_,i)=>({id:'gid://shopify/Collection/'+(i+1),title:'Prom '+i,handle:'prom-'+i,_count:{products:20},products:[{product:{images:[{src:'https://cdn.shopify.com/dress.jpg'}]}}]}));
  const service=await loadModule('app/services/searchCollectionPicker.server.js',{'../db.server':{default:{collection:{findMany:async args=>{calls.push(args);return rows;}}}}});
  const result=await service.listSearchCollections('owner.myshopify.com',{query:' Prom ',after:'gid://shopify/Collection/10'});
  assert.equal(calls[0].where.shop,'owner.myshopify.com');
  assert.equal(calls[0].where.OR[0].title.contains,'Prom');
  assert.equal(calls[0].where.OR[0].title.mode,'insensitive');
  assert.equal(calls[0].select.products.where.product.shop,'owner.myshopify.com');
  assert.equal(calls[0].take,41);assert.equal(calls[0].skip,1);
  assert.equal(result.collections.length,40);assert.equal(result.hasMore,true);
  assert.equal(result.nextCursor,'gid://shopify/Collection/40');
  assert.equal(result.collections[0].image,'https://cdn.shopify.com/dress.jpg');
  assert.equal(result.collections[0].productCount,20);
  rows.splice(1);rows[0].products[0].product.images=['javascript:alert(1)'];
  const last=await service.listSearchCollections('owner.myshopify.com');
  assert.equal(last.hasMore,false);assert.equal(last.nextCursor,'');assert.equal(last.collections[0].image,'');
  for(const query of ['x'.repeat(121),'bad\nquery'])await assert.rejects(service.listSearchCollections('owner.myshopify.com',{query}));
});

test('settings collection lookup authenticates and uses saved database collections without a Shopify picker request',async()=>{
  const calls=[];let authorized=true;
  const route=await loadModule('app/routes/app.search.settings.jsx',{
    '../components/CompactSearchSettings':{default:()=>null},'../components/SearchConfigurationLayout':{default:()=>null},react:{},'react-router':{},'@shopify/shopify-app-react-router/server':{boundary:{}},
    '../shopify.server':{authenticate:{admin:async()=>{if(!authorized)throw Error('Unauthorized');return {session:{shop:'owner.myshopify.com'}};}}},
    '../utils/searchSettings.js':schema,'../services/searchSettings.server.js':{getSearchSettings:async()=>{throw Error('Should not read normal settings during collection lookup');}},
    '../services/searchCollectionPicker.server.js':{listSearchCollections:async(shop,options)=>{calls.push({shop,...options});return {collections:[{id:'gid://shopify/Collection/1',title:'Saved Prom',handle:'prom'}]};}},
  });
  const request=new Request('https://app.test/app/search/settings?collectionPicker=1&q=Prom&after=abc&shop=attacker.myshopify.com');
  const result=await route.loader({request});
  assert.equal(result.collections[0].title,'Saved Prom');
  assert.equal(calls[0].shop,'owner.myshopify.com');assert.equal(calls[0].query,'Prom');assert.equal(calls[0].after,'abc');
  authorized=false;await assert.rejects(route.loader({request}),/Unauthorized/);assert.equal(calls.length,1);
});
