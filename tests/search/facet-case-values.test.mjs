import test from 'node:test';
import assert from 'node:assert/strict';
import {groupFacetValues,facetValueKey,facetSelectionIncludes} from '../../app/utils/facetNormalization.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {availableOptionFacetCounts} from '../../app/utils/availableOptionFacetCounts.js';
import {createLoadingServer} from '../collection-loading/server.mjs';
import {loadModule,loadRanking} from './helpers/search-ranking.mjs';

test('case grouping preserves raw tokens, stable labels, distinct colours and explicit rule precedence',()=>{
 const values=['TEAL',' Teal ','Teal','Dark Teal','WHITE','White','Off White','ORANGE','Orange'];
 const expected=['Dark Teal','Off White','Orange','Teal','White'];
 for(const raw of [values,values.slice().reverse()]){
  const groups=groupFacetValues('Color',raw);
  assert.deepEqual(groups.map(g=>g.value).sort(),expected);
  assert.equal(groups.find(g=>g.key==='teal').rawValues.length,3);
 }
 const rules=[{filterType:'Color',targetValue:'Merchant Teal',sourceValues:['TEAL','Ocean Teal']},{filterType:'Color',targetValue:'Do not win',sourceValues:['teal']}];
 const groups=groupFacetValues('Color',['TEAL','Teal','Ocean Teal','Dark Teal'],rules);
 assert.deepEqual(groups.map(g=>g.value),['Merchant Teal','Dark Teal']);
 assert.equal(groups[0].rawValues.length,3);
 assert.equal(facetSelectionIncludes([' TEAL '],'Teal'),true);
 assert.equal(facetSelectionIncludes(['Teal'],'Dark Teal'),false);
 assert.equal(facetSelectionIncludes(['White'],'Off White'),false);
});

test('the actual selection updater clears equivalent spellings without clearing distinct colours',async()=>{
 const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
 const context={facetValueKey,facetSelectionIncludes};
 vm.runInNewContext(source.slice(source.indexOf('  function updateFilterArray('),source.indexOf('  // Selection feedback belongs')),context);
 const values=['TEAL',' Teal ','Dark Teal'];context.updateFilterArray(values,'Teal',true);assert.equal(values.length,3);
 context.updateFilterArray(values,'teal',false);assert.deepEqual(values,['Dark Teal']);
});

test('collection API renders one choice per colour, counts product unions and restores every equivalent selection',async()=>{
 const fixture=await createLoadingServer();
 try{
  Object.assign(fixture.state,{delay:0,noPins:true,noMerchandising:true,filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Colour'}]});
  const colors=[['Teal','TEAL'],['TEAL'],[' Teal '],['Dark Teal'],['White','WHITE'],['WHITE'],['Off White'],['Orange','ORANGE'],['ORANGE']];
  fixture.documents.splice(colors.length);
  fixture.documents.forEach((p,index)=>{p.vendor=index===2?'Other':'Fixture';p.options=[{name:'Color',values:colors[index]}];p.variantPrices=colors[index].map((color,i)=>({id:String(index*10+i+1),price:50,available:true,option1:color}));});
  const base='https://fixture/api/filter?shop=headless-fixture.myshopify.com&collectionHandle=fixture&sortBy=manual&limit=25&country=US';
  const read=async extra=>{const response=await fixture.load(new Request(base+extra));const body=await response.json();assert.equal(response.status,200,body.error);return body;};
  const body=await read('');
  assert.equal(body.totalCount,9);
  assert.deepEqual(Object.fromEntries(body.facets.options.Color.map(item=>[item.value,item.count])),{'Dark Teal':1,'Off White':1,Orange:2,Teal:3,White:2});
  for(const value of ['Teal','TEAL',' Teal ','teal']){
   const selected=await read('&options[Color][]='+encodeURIComponent(value));
   assert.equal(selected.totalCount,3);assert.deepEqual(selected.products.map(p=>p.id).sort(),['1','2','3'].map(id=>'gid://shopify/Product/'+id));
   assert.equal(selected.facets.options.Color.find(item=>facetValueKey(item.value)==='teal').count,3);
  }
  const narrowed=await read('&vendor[]=Fixture');assert.equal(narrowed.facets.options.Color.find(item=>item.value==='Teal').count,2);
  fixture.state.mergedValues=[{filterType:'Color',targetValue:'Configured Teal',sourceValues:['Teal']}];
  const merged=await read('');assert.equal(merged.facets.options.Color.find(item=>item.value==='Configured Teal').count,3);
  assert.equal(merged.facets.options.Color.find(item=>item.value==='Dark Teal').count,1);
  assert.equal((await read('&options[Color][]=Configured%20Teal')).totalCount,3);
 }finally{fixture.dispose();}
});

test('ranked search counts each eligible product once per normalized colour after exclusions',async()=>{
 const colors=[['Teal','TEAL'],['TEAL'],[' Teal '],['Teal'],['Dark Teal']];
 const docs=colors.map((values,i)=>({id:String(i+1),status:'ACTIVE',title:'Dress '+i,vendor:i===3?'Excluded':'Visible',options:[{name:'Color',values}],variantPrices:values.map(value=>({option1:value,available:true}))}));
 const search=async(_q,o)=>({hits:structuredClone(docs.slice(o.offset||0,(o.offset||0)+o.limit)),totalHits:docs.length});
 const {rankSearchResults}=await loadRanking({},search);
 const result=await rankSearchResults({shop:'fixture.myshopify.com',query:'dress',stableMembership:true,options:{filter:[]},facetKeys:['option_Color'],rule:{conditions:[{action:'Exclude',field:'Vendor',value:'Excluded'}]}});
 assert.equal(result.total,4);assert.equal(result.normalizedFacetCounts.option_Color.teal,3);assert.equal(result.normalizedFacetCounts.option_Color['dark teal'],1);
});

test('available-variant SQL uses one grouped DISTINCT product count for all case aliases',async()=>{
 const queries=[];
 const database={$queryRaw:async query=>{queries.push(query);return [{name:'Color',value:'Teal',count:3}];}};
 const counts=await availableOptionFacetCounts(database,{shop:'tenant',productIds:['1','2','3','1'],optionValues:{Color:['Teal','TEAL',' Teal ']}});
 assert.deepEqual(counts,{Color:{Teal:3}});assert.equal(queries.length,1);
 assert.match(queries[0].text,/count\(DISTINCT p\."id"\)/);
 assert.equal(queries[0].values.filter(value=>value==='Teal').length,4,'three canonical labels plus the original raw token');
});

test('facet search collapses aliases with one batched union count and tenant/collection scope',async()=>{
 const batches=[],cache=new Map();
 const route=await loadModule('app/routes/api.facet.jsx',{
  'react-router':{data:(v,init)=>Response.json(v,init)},'../db.server':{default:{collection:{findFirst:async()=>({id:'gid://shopify/Collection/7'})},mergedValue:{findMany:async({where})=>{assert.deepEqual(JSON.parse(JSON.stringify(where)),{shop:'tenant.myshopify.com',isActive:true});return [];}}}},
  '../services/rateLimiter.server':{rateLimit:async()=>true},'../services/shopCache.server':{getCached:async(key,read)=>{if(!cache.has(key))cache.set(key,await read());return cache.get(key);}},
  '../services/meiliClient.server':{default:{index:()=>({searchForFacetValues:async()=>({facetHits:[{value:'Teal',count:2},{value:'TEAL',count:2},{value:'Dark Teal',count:1}]})}),multiSearch:async({queries})=>{batches.push(queries);return {results:queries.map(q=>({totalHits:q.filter.at(-1).includes('Dark Teal')?1:3}))};}}},
 });
 const response=await route.loader({request:new Request('https://fixture/api/facet?shop=tenant.myshopify.com&collectionHandle=prom&facetName=options.Color&facetQuery=teal')});
 const body=await response.json();assert.equal(response.status,200,body.message);
 assert.deepEqual(body.facetHits.map(h=>({value:h.value,count:h.count})),[{value:'Teal',count:3},{value:'Dark Teal',count:1}]);
 assert.equal(batches.length,1);assert.equal(batches[0].length,2);
 for(const query of batches[0]){assert.ok(query.filter.some(f=>f.includes('tenant.myshopify.com')));assert.ok(query.filter.some(f=>f.includes('gid://shopify/Collection/7')));assert.equal(query.attributesToRetrieve.length,0);}
 assert.equal((await route.loader({request:new Request('https://fixture/api/facet?shop=tenant.myshopify.com&collectionHandle=prom&facetName=options.Color&facetQuery=TEAL')})).status,200);
 assert.equal(batches.length,1,'equivalent repeated facet searches reuse union counts');
});
