import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {normalizeProductTitleFilter} from '../../app/utils/productTitleFilter.js';
import {extraSelections,numericFilterRange,readExtraProductFacts,extraFilterChoices,hasUsableExtraFacets} from '../../app/utils/extraProductFilters.js';
import {hydrateProductFilterFacts,weightInGrams} from '../../app/utils/productFilterFacts.js';
import {createLoadingServer} from '../collection-loading/server.mjs';
const filters=[
  {id:'w',filterType:'weight',label:'Weight',isEnabled:true,displayMode:'List',config:{multipleSelection:true,weightRanges:[{from:'0',to:'500',label:'{0} - {1} g'},{from:'501',to:'',label:'From {0} g'}]}},
  {id:'r',filterType:'review_rating',label:'Rating',isEnabled:true,displayMode:'List',config:{reviewRanges:[{from:'0',to:'',label:'No reviews'},{from:'4',to:'',label:'4 stars and up'}]}},
  {id:'l',filterType:'inventory_locations',label:'Ships from',isEnabled:true,displayMode:'List',config:{}},
  {id:'s',filterType:'stock_status',label:'Stock',isEnabled:true,displayMode:'List',config:{stockStatusConfig:{inStock:{enabled:true,label:'Available'},stockOnHand:{enabled:true,label:'Ready to ship'},preOrder:{enabled:true,label:'Preorder'},outOfStock:{enabled:true,label:'Sold out'}}}},
];

test('numeric and location selections validate without turning unknown weights or reviews into zero',async()=>{
  assert.equal(numericFilterRange('weight','1','').max,Infinity);
  assert.equal(numericFilterRange('review_rating','0','').max,0);
  assert.equal(numericFilterRange('review_rating','4','').max,5);
  for(const query of ['weight[]=-1:2','weight[]=4:2','rating[]=0:6','rating[]=NaN:5','availability[]=made_up'])assert.throws(()=>extraSelections(new URLSearchParams(query)));
  const rows=await readExtraProductFacts({$queryRaw:async()=>[{id:'1',available:true,onhand:false,preorder:true,rating:'{"value":"9","scale_max":"10"}',facts:'{"weights":[100,null,-1],"locations":[{"id":"loc","label":"Warehouse"}]}'},{id:'2',rating:null,facts:null}]},'tenant');
  assert.equal(rows[0].rating,4.5);assert.deepEqual(rows[0].weights,[100]);assert.equal(rows[1].rating,null);assert.deepEqual(rows[1].weights,[]);
  assert.equal(extraFilterChoices(filters,rows).filter(c=>c.type==='inventory_locations').length,1);
  assert.equal(hasUsableExtraFacets({settings:filters,facets:{}}),false);
  assert.equal(hasUsableExtraFacets({settings:filters,facets:{extraFilters:{version:1}}}),true);
});

test('actual API applies weight, rating, location and configured stock filters with disjunctive counts',async()=>{
  const f=await createLoadingServer();
  try{
    Object.assign(f.state,{noPins:true,noMerchandising:true,filterSettings:filters,extraFacts:{
      '1':{facts:JSON.stringify({weights:[100,600],locations:[{id:'gid://shopify/Location/1',label:'Main warehouse'}]}),rating:'{"value":"4.5","scale_max":"5"}',preorder:true},
      '2':{facts:JSON.stringify({weights:[200],locations:[{id:'gid://shopify/Location/2',label:'Other warehouse'}]}),rating:'3.0'},
      '3':{available:false,onhand:false,preorder:false,facts:'{"weights":[800],"locations":[]}'},
    }});
    const url=new URL('http://fixture/api/filter?shop=headless-fixture.myshopify.com&collectionHandle=fixture&sortBy=manual&page=1&limit=25');
    const read=async()=>{const response=await f.load(new Request(url));assert.equal(response.status,200);return response.json();};
    let body=await read();const choices=body.facets.extraFilters.choices;
    assert.equal(choices.find(c=>c.type==='weight'&&c.value==='0:500').count,2);
    assert.equal(choices.find(c=>c.type==='review_rating'&&c.value==='0:0').count,28);
    assert.equal(choices.find(c=>c.type==='stock_status'&&c.value==='pre_order').count,1);
    for(const [parameter,value,total] of [['weight[]','0:500',2],['weight[]','501:Infinity',2],['rating[]','4:5',1],['rating[]','0:0',28],['location[]','gid://shopify/Location/1',1],['availability[]','pre_order',1],['availability[]','out_of_stock',1]]){
      url.search='?shop=headless-fixture.myshopify.com&collectionHandle=fixture&sortBy=manual&page=1&limit=25';url.searchParams.set(parameter,value);body=await read();assert.equal(body.totalCount,total,parameter+'='+value);
    }
    url.searchParams.delete('availability[]');url.searchParams.set('weight[]','0:500');url.searchParams.set('rating[]','4:5');url.searchParams.set('location[]','gid://shopify/Location/1');body=await read();assert.equal(body.totalCount,1);
    url.searchParams.set('location[]','gid://shopify/Location/2');body=await read();assert.equal(body.totalCount,0);
    url.searchParams.set('rating[]','4:8');assert.equal((await f.load(new Request(url))).status,400);
  }finally{f.dispose();}
});

test('stock and comma-containing categorical values survive URL reloads without splitting',async()=>{
  const source=(await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8')).replace(/\r\n/g,'\n');
  const parse=source.slice(source.indexOf('  function parseURLState()'),source.indexOf('  function syncSortControls()'));
  const start=source.indexOf('  function syncStateToURL()'),sync=source.slice(start,source.indexOf('\n  }',start)+4);
  const params=new URLSearchParams({'availability[]':'pre_order','weight[]':'100:500','rating[]':'4:5','location[]':'gid://shopify/Location/1','vendors[]':'A, Inc.','collections[]':'Blue, Evening','options[Color][]':'Red, White','metafields[custom.fabric][]':'Silk, Cotton'});
  const activeFilters={options:{},metafields:{},minPrice:0,maxPrice:999999,page:1};let saved;
  const context={URLSearchParams,activeFilters,searchTerms:'',templateName:'collection',window:{location:{pathname:'/collections/all',search:'?'+params},history:{replaceState:(_a,_b,url)=>saved=url}}};
  vm.runInNewContext(parse+sync+';parseURLState();syncStateToURL();',context);
  const restored=new URL(saved,'http://fixture').searchParams;
  for(const [key,value]of params)assert.deepEqual(restored.getAll(key),[value],key);
});

test('custom option titles do not become the underlying option key on creation or edit',async()=>{
  const source=await fs.readFile('app/routes/app.filters.groups.$id.jsx','utf8');const ast=ts.createSourceFile('route.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const actionSource=ast.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)==='action')).declarationList.declarations[0].initializer.getText(ast);
  const writes=[],prisma={filterGroup:{findFirst:async()=>({id:'group'})},filterGroupItem:{findFirst:async()=>null,create:async value=>writes.push(value),update:async value=>writes.push(value)},$queryRaw:async()=>[{name:'Color'}]};
  const action=vm.runInNewContext('('+actionSource+')',{prisma,normalizeProductTitleFilter,authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})},invalidateShop:async()=>{},data:value=>value});
  for(const intent of ['addFilter','updateFilter']){
    await action({params:{id:'group'},request:new Request('http://fixture/app',{method:'POST',body:new URLSearchParams({intent,filterId:'color',filterType:'color',label:'Shop by shade',displayMode:'Swatch'})})});
    assert.equal(writes.at(-1).data.filterKey,'Color');assert.equal(writes.at(-1).data.label,'Shop by shade');assert.equal(writes.at(-1).data.filterType,'option');
  }
});

test('sync converts weight units and completes inventory pages before saving app-owned facts',async()=>{
  assert.equal(weightInGrams({value:2,unit:'KILOGRAMS'}),2000);assert.equal(weightInGrams({value:1,unit:'POUNDS'}),453.59237);assert.equal(weightInGrams(null),null);
  const product={id:'p',variants:{nodes:[{id:'v',inventoryItem:{id:'i',measurement:{weight:{value:0.5,unit:'KILOGRAMS'}}}}]},metafields:{nodes:[{id:'rating',namespace:'reviews',key:'rating',value:'4'}]}};
  let calls=0;const admin={graphql:async(query,{variables})=>({json:async()=>{calls++;if(query.includes('FilterInventoryPage')){assert.equal(variables.after,'next');return {data:{inventoryItem:{inventoryLevels:{nodes:[{location:{id:'l2',name:'Second'},quantities:[{name:'available',quantity:3}]}],pageInfo:{hasNextPage:false}}}}};}return {data:{nodes:[{id:'i',inventoryLevels:{nodes:[{location:{id:'l1',name:'Empty'},quantities:[{name:'available',quantity:0}]}],pageInfo:{hasNextPage:true,endCursor:'next'}}}]}};}})};
  await hydrateProductFilterFacts(product,admin,{filterGroupItem:{findFirst:async()=>({id:'location-filter'})}},'tenant');assert.equal(calls,2);
  const facts=JSON.parse(product.metafields.nodes.find(m=>m.namespace==='__cfp_internal').value);assert.deepEqual(facts.weights,[500]);assert.deepEqual(facts.locations,[{id:'l2',label:'Second'}]);assert.equal(product.metafields.nodes[0].id,'rating');
  const copy=structuredClone(product);await assert.rejects(()=>hydrateProductFilterFacts(copy,{graphql:async()=>({json:async()=>({errors:[{message:'No access'}]})})},{filterGroupItem:{findFirst:async()=>({id:'location-filter'})}},'tenant'));assert.deepEqual(copy,product,'failed reads do not replace complete facts');
});

test('actual API supports every categorical type plus exact disjoint price ranges and full counts',async()=>{
 const f=await createLoadingServer();
 try{
  const definitions=[['vendor',null],['product_type',null],['tag',null],['collection',null],['title',null],['option','Color'],['option','Size'],['option','Slot'],['metafield','custom.fabric']].map(([filterType,filterKey],i)=>({id:String(i),filterType,filterKey,label:filterKey||filterType,isEnabled:true,displayMode:'List',config:{}}));
  definitions.push({id:'price',filterType:'price',isEnabled:true,displayMode:'List',config:{priceRanges:[{from:'0',to:'10',label:'{0} - {1}'},{from:'20',to:'',label:'From {0}'}]}});
  Object.assign(f.state,{noPins:true,noMerchandising:true,filterSettings:definitions});
  Object.assign(f.documents[0],{vendor:'Acme',productType:'Coat',tags:['Featured'],collection_titles:['Special'],options:[{name:'Color',values:['Red']},{name:'Size',values:['S']},{name:'Slot',values:['Morning']}],variantPrices:[{id:'100',price:1,available:true,option1:'Red',option2:'S',option3:'Morning'}],'metafield_custom.fabric':'Silk'});
  const url=new URL('http://fixture/api/filter?shop=headless-fixture.myshopify.com&collectionHandle=fixture&sortBy=manual&page=1&limit=25');
  const read=async()=>{const response=await f.load(new Request(url));assert.equal(response.status,200);return response.json();};
  let body=await read();assert.equal(body.totalCount,30);assert.equal(body.facets.priceRanges.ranges[0].count,10);assert.equal(body.facets.priceRanges.ranges[1].count,11);
  definitions.at(-1).displayMode='Range';f.facetRequests.length=0;
  body=await read();assert.equal(body.facets.priceRanges.ranges.length,0);
  assert.equal(f.facetRequests.some(query=>query.filter?.some(value=>typeof value==='string'&&value.includes('priceMin >= 20'))),false);
  delete definitions.at(-1).displayMode;
  body=await read();assert.equal(body.facets.priceRanges.ranges[0].count,10,'saved filters without displayMode default to List');
  const params=[['vendor[]','Acme'],['type[]','Coat'],['tags[]','Featured'],['collection[]','Special'],['title[]','Fixture dress 1'],['options[Color][]','Red'],['options[Size][]','S'],['options[Slot][]','Morning'],['metafields[custom.fabric][]','Silk']];
  for(const [key,value]of params){url.search='?shop=headless-fixture.myshopify.com&collectionHandle=fixture&sortBy=manual&page=1&limit=25';url.searchParams.set(key,value);body=await read();assert.equal(body.totalCount,1,key);assert.equal(body.products[0].title,'Fixture dress 1');}
  url.searchParams.delete('metafields[custom.fabric][]');url.searchParams.set('price[]','0:10');url.searchParams.append('price[]','20:Infinity');body=await read();assert.equal(body.totalCount,21);assert.equal(body.facets.priceRanges.ranges[0].count,10);assert.equal(body.facets.priceRanges.ranges[1].count,11);assert.ok(body.products.every(p=>p.priceMin<=10||p.priceMin>=20));
 }finally{f.dispose();}
});

test('weight sync batches variant measurements without making the main catalog query more expensive',async()=>{
 const product={id:'p',variants:{nodes:[{id:'gid://shopify/ProductVariant/1'}]},metafields:{nodes:[]}};let calls=0;
 const admin={graphql:async(query,{variables})=>{calls++;assert.ok(query.includes('FilterVariantMeasurements'));assert.deepEqual(variables.ids,['gid://shopify/ProductVariant/1']);return {json:async()=>({data:{nodes:[{id:variables.ids[0],inventoryItem:{id:'i',measurement:{weight:{value:2,unit:'OUNCES'}}}}]}})};}};
 await hydrateProductFilterFacts(product,admin,{filterGroupItem:{findFirst:async()=>null}},'tenant');
 assert.equal(calls,1);const facts=JSON.parse(product.metafields.nodes[0].value);assert.equal(facts.weights[0],56.69904625);assert.deepEqual(facts.locations,[]);
});

test('explicit review rating survives the general metafield page and explicit removal clears it',async()=>{
 const rating={id:'rating',namespace:'reviews',key:'rating',value:'4.5',type:'rating'};
 const product={variants:{nodes:[]},metafields:{nodes:Array.from({length:250},(_,i)=>({id:String(i),namespace:'custom',key:String(i),value:'x'}))},ratingMetafield:rating};
 await hydrateProductFilterFacts(product,{},{});assert.equal(product.metafields.nodes.length,251);assert.equal(product.metafields.nodes.at(-1),rating);
 product.ratingMetafield=null;await hydrateProductFilterFacts(product,{},{});assert.equal(product.metafields.nodes.length,250);
});
