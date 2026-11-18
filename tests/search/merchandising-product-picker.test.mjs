import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';

test('catalog product search pages beyond the initial options without duplicates and searches handles',async()=>{
 const shop='owner.myshopify.com',calls=[];
 const catalog=Array.from({length:300},(_,i)=>({shop,id:'gid://shopify/Product/'+(i+1),title:i===299?'Known published gown':'Catalog '+String(i).padStart(3,'0'),handle:'dress-'+i,images:[],variants:i===299?[]:[{id:'v'+i}]}));
 catalog.push({shop:'foreign.myshopify.com',id:'foreign',title:'Known published gown',handle:'foreign',images:[],variants:[]});
 const service=await loadModule('app/services/searchCollectionPicker.server.js',{'../db.server':{default:{product:{findMany:async args=>{calls.push(args);const q=args.where.OR?.[0].title.contains||'';let rows=catalog.filter(p=>p.shop===args.where.shop&&(!q||(p.title+' '+p.handle).toLowerCase().includes(q.toLowerCase())));if(args.cursor)rows=rows.slice(rows.findIndex(p=>p.id===args.cursor.id)+1);return rows.slice(0,args.take);}},filterGlobalSetting:{findUnique:async()=>({showOnlyInStock:true})}}}});
 const first=await service.listSearchProducts(shop,{query:'Catalog'}),second=await service.listSearchProducts(shop,{query:'Catalog',after:first.nextCursor});
 assert.equal(first.products.length,20);assert.equal(second.products.length,20);assert.equal(new Set([...first.products,...second.products].map(p=>p.id)).size,40);assert.equal(calls[1].skip,1);assert.equal(calls[1].cursor.id,first.nextCursor);
 const found=await service.listSearchProducts(shop,{query:'dress-299'});assert.equal(found.products.length,1);assert.equal(found.products[0].title,'Known published gown');assert.equal(found.products[0].available,false);assert.equal(found.hasMore,false);
 assert.ok(calls.every(call=>call.where.shop===shop&&call.take===21));
 await assert.rejects(service.listSearchProducts(shop,{after:'bad\ncursor'}),/Invalid/);
});

test('the authenticated catalog resource forwards product cursors and ignores supplied shops',async()=>{
 const calls=[];
 const route=await loadModule('app/routes/app.product-picker.jsx',{
  '../shopify.server':{authenticate:{admin:async()=>({session:{shop:'owner.myshopify.com'}})}},
  '../services/searchCollectionPicker.server.js':{listSearchProducts:async(shop,options)=>{calls.push({shop,...options});return {products:[],...options};},listSearchCollections:async()=>({collections:[]})},
  '../services/searchPicker.server.js':{searchPickerPage:async()=>({products:[]})},'../utils/pinProductSearch.server':{},'../db.server':{default:{}},
 });
 const response=await route.loader({request:new Request('https://app.test/app/product-picker?scope=products&shop=foreign.myshopify.com&q=gown&after=last-id')});
 assert.equal(response.status,200);assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{shop:'owner.myshopify.com',query:'gown',after:'last-id'}]);
});
