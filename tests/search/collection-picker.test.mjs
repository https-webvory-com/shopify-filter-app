import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import * as schema from '../../app/utils/searchSettings.js';

test('saved collection picker searches only the authenticated shop with bounded pagination and product thumbnails',async()=>{
  const calls=[],metadataCalls=[];
  const rows=Array.from({length:41},(_,i)=>({id:'gid://shopify/Collection/'+(i+1),title:'Prom '+i,handle:'prom-'+i}));
  let image='https://cdn.shopify.com/dress.jpg';
  const service=await loadModule('app/services/searchCollectionPicker.server.js',{'../db.server':{default:{collection:{findMany:async args=>{calls.push(args);return rows;}},$queryRaw:async(strings,...values)=>{metadataCalls.push({sql:strings.join('?'),values});return values[2].map(id=>({id,productCount:20,images:[{src:image}]}));}}}});
  const result=await service.listSearchCollections('owner.myshopify.com',{query:' Prom ',after:'gid://shopify/Collection/10'});
  assert.equal(calls[0].where.shop,'owner.myshopify.com');
  assert.equal(calls[0].where.OR[0].title.contains,'Prom');
  assert.equal(calls[0].where.OR[0].title.mode,'insensitive');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].select)),{id:true,title:true,handle:true});
  assert.deepEqual(metadataCalls[0].values.slice(0,2),['owner.myshopify.com','owner.myshopify.com']);
  assert.deepEqual(Array.from(metadataCalls[0].values[2]),rows.slice(0,40).map(row=>row.id));
  assert.match(metadataCalls[0].sql,/COUNT\(\*\)::integer/);
  assert.match(metadataCalls[0].sql,/pc\."collectionId" = c\."id"/);
  assert.match(metadataCalls[0].sql,/p\."status" IN \('ACTIVE', 'active'\)/);
  assert.match(metadataCalls[0].sql,/ORDER BY pc\."productId" ASC LIMIT 1/);
  assert.equal(calls[0].take,41);assert.equal(calls[0].skip,1);
  assert.equal(result.collections.length,40);assert.equal(result.hasMore,true);
  assert.equal(result.nextCursor,'gid://shopify/Collection/40');
  assert.equal(result.collections[0].image,'https://cdn.shopify.com/dress.jpg');
  assert.equal(result.collections[0].productCount,20);
  rows.splice(1);image='javascript:alert(1)';
  const last=await service.listSearchCollections('owner.myshopify.com');
  assert.equal(last.hasMore,false);assert.equal(last.nextCursor,'');assert.equal(last.collections[0].image,'');
  for(const query of ['x'.repeat(121),'bad\nquery'])await assert.rejects(service.listSearchCollections('owner.myshopify.com',{query}));
  rows.length=0;
  const empty=await service.listSearchCollections('owner.myshopify.com',{query:'missing'});
  assert.equal(empty.collections.length,0);assert.equal(metadataCalls.length,2);
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
