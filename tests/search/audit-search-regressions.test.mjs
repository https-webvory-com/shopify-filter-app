import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {loadModule} from './helpers/search-ranking.mjs';
import * as semantic from '../../app/utils/semanticSearch.js';

test('an edited alias with one populated branch gets exact native facets and bounded native pages',async()=>{
 let replacement='wedding dress';const native=[],probes=[];
 const service=await loadModule('app/services/semanticSearch.server.js',{
  './searchIndex.server.js':{prepareConfiguredSearchQueries:async qs=>qs.map(q=>({...q,indexUid:'private-shop',_cfpSynonymQueries:[replacement]}))},
  './meiliClient.server':{default:{multiSearch:async request=>{assert.equal(request.federation,undefined,'no federated catalog-prefix scans');probes.push(request);return {results:[{totalHits:0},{totalHits:20000}]};},index:()=>({getSettings:async()=>({pagination:{maxTotalHits:100000}}),search:async(q,options)=>{native.push({q,options});return {hits:options.attributesToRetrieve?.length===0?[{}]:[{id:'1',title:q}],totalHits:20000,facetDistribution:{color:{White:20000}}};}})}},
  './shopCache.server':{getCached:async(_key,read)=>read()},'../utils/semanticSearch.js':semantic,
 });
 const filter=['shop = "owner.myshopify.com"','available = true'];
 const {results:[count]}=await service.searchPageBatch([{q:'audit alias',filter,attributesToRetrieve:[],facets:['color'],page:1,hitsPerPage:1}],false);
 assert.equal(count.totalHits,20000);assert.equal(count.facetDistribution.color.White,20000);
 const page=await service.keywordSearch('audit alias',{filter,offset:25,limit:25,facets:['color']});
 assert.equal(page.hits[0].title,'wedding dress');assert.equal(native[1].options.offset,25);assert.equal(native[1].options.limit,25);
 replacement='short dress';await service.keywordSearch('audit alias',{filter,offset:0,limit:4});
 assert.equal(native[2].q,'short dress');
 for(const call of native)assert.deepEqual(Array.from(call.options.filter),filter);
 assert.equal(probes.length,3);
});

test('descending product price selects the minimum variant, with the configured stock restriction',async()=>{
 const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
 const code=source.slice(source.indexOf('  function priceSortedVariant('),source.indexOf('  function updateMarketCardPrice('));
 const context={activeFilters:{sortBy:'price-descending'},globalSettings:{showOnlyInStock:true}};
 vm.runInNewContext(code,context);
 const variants=[{id:'sold-out',price:5,available:false},{id:'min',price:3202,available:true},{id:'max',price:3600,available:true},{id:'invalid',price:null,available:true}];
 assert.equal(context.priceSortedVariant(variants).id,'min');
 context.activeFilters.sortBy='price-ascending';assert.equal(context.priceSortedVariant(variants).id,'min');
 context.globalSettings.showOnlyInStock=false;assert.equal(context.priceSortedVariant(variants).id,'sold-out');
 context.activeFilters.sortBy='relevance';assert.equal(context.priceSortedVariant(variants),null);
});

test('late wishlist provider retries respect current search and stop when no provider is installed',async()=>{
 const source=await fs.readFile('extensions/theme-extension/assets/instantSearch.js','utf8');
 const code=source.slice(source.indexOf('  let marketRenderVersion = 0;'),source.indexOf('  const instantImagePlaceholder='));
 const timers=new Map(),calls=[];let next=0;
 const context={window:{},setTimeout:fn=>{timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),renderProducts:(...args)=>calls.push(args)};
 vm.runInNewContext(code+'\nthis.wait=waitForInstantWishlist;this.version=v=>marketRenderVersion=v;',context);
 const tick=()=>{const entry=timers.entries().next().value;if(entry){timers.delete(entry[0]);entry[1]();}};
 const data={globalSettings:{integrations:{wishlist:true}}};
 context.wait(data,'prom',false,true,0);tick();context.window.pageDataMap={};tick();assert.equal(calls.length,1);assert.equal(calls[0][1],'prom');
 delete context.window.pageDataMap;context.wait(data,'old',false,true,0);context.version(1);tick();assert.equal(calls.length,1);assert.equal(timers.size,0);
 context.wait(data,'current',false,true,1);for(let i=0;i<121;i++)tick();assert.equal(timers.size,0);assert.equal(context.window.pageDataMap,undefined);
});
