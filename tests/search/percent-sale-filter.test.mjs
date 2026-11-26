import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {saleRange,parseSaleSelections,configuredSaleRanges,saleIdsFilter,hasUsableSaleFacets,readProductSalePercentages} from '../../app/utils/percentSaleFilter.js';
import {createLoadingServer} from '../collection-loading/server.mjs';
import {visibleCollectionFacets} from '../../app/utils/collectionBootstrap.js';
const filter={id:'sale',filterType:'percent_sale',label:'Discount',isEnabled:true,displayMode:'List',config:{multipleSelection:true,saleRanges:[{from:'0',to:'10',label:'{0}% - {1}%'},{from:'20',to:'30',label:'{0}% - {1}%'},{from:'50',to:'',label:'From {0}%'}]}};

test('sale ranges retain decimals, open bounds, and reject malformed values',()=>{
  assert.deepEqual(saleRange('10.5',''),{min:10.5,max:100});
  for(const pair of [[-1,20],[20,10],[0,101],['bad',20]])assert.equal(saleRange(...pair),null);
  assert.deepEqual(parseSaleSelections(new URLSearchParams('sale[]=20:30&sale[]=50:100')),[{min:20,max:30},{min:50,max:100}]);
  for(const value of ['NaN:100','20:10','0:101','0:10 OR true'])assert.throws(()=>parseSaleSelections(new URLSearchParams({'sale[]':value})));
  assert.equal(configuredSaleRanges([filter])[2].max,100);
  assert.equal(saleIdsFilter([{id:'1',percent:25},{id:'2',percent:10},{id:'3',percent:50}],parseSaleSelections(new URLSearchParams('sale[]=20:30&sale[]=50:100'))),'id IN ["1","3"]');
});

test('sale SQL binds the tenant and aggregates variants rather than averaging or summing discounts',async()=>{
  let query,parameters;
  const rows=await readProductSalePercentages({$queryRaw:async(strings,...values)=>{query=strings.join('?');parameters=values;return [{id:'gid://shopify/Product/1',percent:25}];}},"tenant'quoted");
  assert.deepEqual(parameters,["tenant'quoted"]);assert.match(query,/MAX\(CASE/);assert.match(query,/LEFT JOIN "Variant"/);assert.match(query,/GROUP BY p.id/);
  assert.deepEqual(rows,[{id:'1',percent:25}]);
});

test('saved pages missing sale facets rebuild, and compact responses retain the new facets',()=>{
  assert.equal(hasUsableSaleFacets({settings:[filter],facets:{}}),false);
  assert.equal(hasUsableSaleFacets({settings:[{...filter,isEnabled:false}],facets:{}}),true);
  const facets={percentSale:{version:1,ranges:[]}};
  assert.equal(hasUsableSaleFacets({settings:[filter],facets}),true);
  assert.deepEqual(visibleCollectionFacets(facets,[filter]),facets);
});

test('actual API filters by sale percentage with exact full-collection disjunctive counts and OR selections',async()=>{
  const fixture=await createLoadingServer();
  try{
    Object.assign(fixture.state,{noPins:true,noMerchandising:true,filterSettings:[filter],salePercentages:{'1':25,'2':25,'27':50,'28':75,'29':10,'30':30}});
    const url=new URL('http://fixture/api/filter?shop=headless-fixture.myshopify.com&collectionHandle=fixture&sortBy=manual&page=1&limit=25');
    let response=await fixture.load(new Request(url)),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.totalCount,30);assert.equal(body.products.length,25);
    assert.deepEqual(body.facets.percentSale.ranges.map(r=>r.count),[25,3,2]);
    url.searchParams.append('sale[]','20:30');
    response=await fixture.load(new Request(url));body=await response.json();
    assert.equal(response.status,200);assert.equal(body.totalCount,3);assert.deepEqual(body.products.map(p=>p.id.split('/').pop()).sort(),['1','2','30']);
    assert.deepEqual(body.facets.percentSale.ranges.map(r=>r.count),[25,3,2]);
    url.searchParams.append('sale[]','50:100');body=await(await fixture.load(new Request(url))).json();assert.equal(body.totalCount,5);
    url.searchParams.set('title[]','Fixture dress 27');body=await(await fixture.load(new Request(url))).json();assert.equal(body.totalCount,1);assert.equal(body.facets.percentSale.ranges[2].count,1);
    url.searchParams.delete('title[]');url.searchParams.delete('sale[]');url.searchParams.append('sale[]','11:19');body=await(await fixture.load(new Request(url))).json();assert.equal(body.totalCount,0);
    url.searchParams.set('sale[]','0:100');body=await(await fixture.load(new Request(url))).json();assert.equal(body.products.length,25);assert.equal(body.totalCount,30);
    const pageOne=new Set(body.products.map(p=>p.id));url.searchParams.set('page','2');body=await(await fixture.load(new Request(url))).json();assert.equal(body.products.length,5);assert.ok(body.products.every(p=>!pageOne.has(p.id)));
    url.searchParams.set('page','1');url.searchParams.set('sale[]','50:101');response=await fixture.load(new Request(url));assert.equal(response.status,400);
  }finally{fixture.dispose();}
});

 test('sale selections round-trip in the browser URL alongside other filters',async()=>{
  const source=(await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8')).replace(/\r\n/g,'\n');
  const parse=source.slice(source.indexOf('  function parseURLState()'),source.indexOf('  function syncSortControls()'));
  const start=source.indexOf('  function syncStateToURL()');const sync=source.slice(start,source.indexOf('\n  }',start)+4);
  const activeFilters={options:{},metafields:{},page:1,sortBy:'best-selling',minPrice:0,maxPrice:999999};let saved;
  const context={URLSearchParams,activeFilters,searchTerms:'',templateName:'collection',searchHistoryState:null,window:{location:{pathname:'/collections/all',search:'?sale[]=20:30&sale[]=50:100&vendors=Fixture'},history:{replaceState:(_a,_b,url)=>saved=url}}};
  vm.runInNewContext(parse+sync+';parseURLState();syncStateToURL();',context);
  assert.deepEqual([...activeFilters.saleRanges],['20:30','50:100']);assert.deepEqual(new URL(saved,'http://fixture').searchParams.getAll('sale[]'),['20:30','50:100']);
  assert.equal(new URL(saved,'http://fixture').searchParams.get('vendors'),'Fixture');
 });
