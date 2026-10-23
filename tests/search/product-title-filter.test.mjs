import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {normalizeProductTitleFilter,hasUsableProductTitleFacets} from '../../app/utils/productTitleFilter.js';
import {createLoadingServer} from '../collection-loading/server.mjs';

test('legacy Title options resolve to product titles while custom labels and other options are retained',()=>{
  const legacy={filterType:'option',filterKey:'Title',label:'Shop by product name',isEnabled:true,config:{manualValues:['A dress']}};
  assert.deepEqual(normalizeProductTitleFilter(legacy),{...legacy,filterType:'title',filterKey:null});
  assert.equal(legacy.filterType,'option');
  for(const filterKey of ['Color','Size','Subtitle']){const filter={filterType:'option',filterKey,label:'Title'};assert.equal(normalizeProductTitleFilter(filter),filter);}
});

test('saved pages with broken Title facets rebuild without invalidating unrelated publications',()=>{
  const payload={settings:[{filterType:'option',filterKey:'Title',isEnabled:true}],facets:{titles:[]},totalCount:10};
  assert.equal(hasUsableProductTitleFacets(payload),false);
  const settings=payload.settings.map(normalizeProductTitleFilter);
  assert.equal(hasUsableProductTitleFacets({...payload,settings}),false);
  assert.equal(hasUsableProductTitleFacets({...payload,settings,facets:{titles:[{value:'A dress',count:10}]}}),true);
  assert.equal(hasUsableProductTitleFacets({...payload,settings,totalCount:0}),true);
  assert.equal(hasUsableProductTitleFacets({...payload,settings:[{...payload.settings[0],isEnabled:false}]}),true);
  assert.equal(hasUsableProductTitleFacets({settings,products:[]}),true);
  assert.equal(hasUsableProductTitleFacets({...payload,settings:[]}),true);
});

async function adminAction(){
  const source=await fs.readFile('app/routes/app.filters.groups.$id.jsx','utf8');
  const ast=ts.createSourceFile('route.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const action=ast.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)==='action')).declarationList.declarations[0].initializer.getText(ast);
  const writes=[];
  const prisma={filterGroup:{findFirst:async()=>({id:'group'})},filterGroupItem:{findFirst:async()=>null,create:async value=>writes.push(value),update:async value=>writes.push(value)}};
  return {writes,action:vm.runInNewContext('('+action+')',{prisma,normalizeProductTitleFilter,authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})},invalidateShop:async()=>{},data:value=>value})};
}
for(const intent of ['addFilter','updateFilter'])test(`admin ${intent} stores product Title semantics with a custom display label`,async()=>{
  const {action,writes}=await adminAction();
  await action({params:{id:'group'},request:new Request('http://fixture/app',{method:'POST',body:new URLSearchParams({intent,filterId:'title-item',filterType:'title',label:'Shop by product name',filterKey:'incorrect',displayMode:'List'})})});
  assert.equal(writes[0].data.filterType,'title');assert.equal(writes[0].data.filterKey,null);assert.equal(writes[0].data.label,'Shop by product name');
});

test('legacy Title CSV items are imported into the product-title representation',async()=>{
  const {action,writes}=await adminAction();
  await action({params:{id:'group'},request:new Request('http://fixture/app',{method:'POST',body:new URLSearchParams({intent:'importFilters',filters:JSON.stringify([{filterType:'option',filterKey:'Title',label:'Product name',isEnabled:true,displayMode:'List'}])})})});
  assert.equal(writes[0].data.filterType,'title');assert.equal(writes[0].data.filterKey,null);
});

for(const legacy of [false,true])test(`actual API exposes collection-wide title values and filters products (legacy=${legacy})`,async()=>{
  const fixture=await createLoadingServer();
  try{
    fixture.state.noPins=true;fixture.state.noMerchandising=true;fixture.state.filterSettings=[{filterType:legacy?'option':'title',filterKey:legacy?'Title':null,label:'Product name',isEnabled:true}];
    const url=new URL('http://fixture/api/filter?shop=headless-fixture.myshopify.com&collectionHandle=fixture&sortBy=manual&page=1&limit=25');
    let response=await fixture.load(new Request(url)),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.totalCount,30);assert.equal(body.products.length,25);
    assert.equal(body.settings[0].filterType,'title');assert.equal(body.settings[0].label,'Product name');
    assert.equal(body.facets.titles.length,30);assert.ok(body.facets.titles.some(t=>t.value==='Fixture dress 1'));
    url.searchParams.append('title[]','Fixture dress 27');url.searchParams.append('title[]','Fixture dress 28');
    response=await fixture.load(new Request(url));body=await response.json();
    assert.equal(response.status,200);assert.equal(body.totalCount,2);
    assert.deepEqual(body.products.map(p=>p.title).sort(),['Fixture dress 27','Fixture dress 28']);
    assert.equal(body.facets.titles.length,30,'Title choices keep disjunctive collection-wide counts');
    assert.ok(fixture.facetRequests.some(q=>q.filter?.some(f=>f==='title IN ["Fixture dress 27","Fixture dress 28"]')));
  }finally{fixture.dispose();}
});

test('Title selections round-trip through URLs without splitting commas, quotes or unicode',async()=>{
  const source=(await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8')).replace(/\r\n/g,'\n');
  const parse=source.slice(source.indexOf('  function parseURLState()'),source.indexOf('  function syncSortControls()'));
  const end=source.indexOf('\n  }',source.indexOf('  function syncStateToURL()'))+4;
  const completeSync=source.slice(source.indexOf('  function syncStateToURL()'),end);
  const titles=['Evening dress, blue','Women’s "Formal" dress','A \\ B'];
  const params=new URLSearchParams();titles.forEach(t=>params.append('title[]',t));
  const activeFilters={options:{},metafields:{},page:1,sortBy:'best-selling',minPrice:0,maxPrice:999999};
  let saved;
  const context={URLSearchParams,activeFilters,searchTerms:'',window:{location:{pathname:'/collections/all',search:'?'+params},history:{replaceState:(_a,_b,url)=>saved=url}}};
  vm.runInNewContext(parse+completeSync+'\nparseURLState();syncStateToURL();',context);
  assert.deepEqual([...activeFilters.titles],titles);assert.deepEqual(new URL(saved,'http://fixture').searchParams.getAll('title[]'),titles);
});
