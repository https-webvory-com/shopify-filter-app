import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCollectionNavigation,isCollectionNavigation,navigationCollectionTitles,hasUsableCollectionNavigation,navigationCollectionsHelp} from '../../app/utils/collectionNavigation.js';
import {createLoadingServer} from '../collection-loading/server.mjs';

const filter={id:'nav',filterType:'collection',isEnabled:true,label:'Explore collections',config:{navCollections:true,mainCollections:[{id:1,collection:'Formal'},{id:2,collection:'Summer'}],useManualValues:false}};

test('assigned navigation collections resolve real handles in saved order without requiring manual values',async()=>{
  const original=JSON.stringify(filter);
  const [resolved]=await resolveCollectionNavigation([filter],async titles=>{
    assert.deepEqual(titles,['Formal','Summer']);
    return [{title:'Summer',handle:'summer-edit'},{title:'Formal',handle:'designer-evening'}];
  });
  assert.deepEqual(resolved.config.navigationLinks,[{label:'Formal',handle:'designer-evening'},{label:'Summer',handle:'summer-edit'}]);
  assert.equal(JSON.stringify(filter),original);
});

test('navigation never guesses missing handles or trusts imported links and rejects unsafe or ambiguous destinations',async()=>{
  const settings=[{...filter,config:{...filter.config,navigationLinks:[{label:'Fake',handle:'evil'}],mainCollections:[{collection:'Missing'},{collection:'Unsafe'},{collection:'Ambiguous'}]}}];
  const [resolved]=await resolveCollectionNavigation(settings,async()=>[{title:'Unsafe',handle:'../admin'},{title:'Ambiguous',handle:'first'},{title:'Ambiguous',handle:'second'}]);
  assert.deepEqual(resolved.config.navigationLinks,[]);
});

test('ordinary filters and disabled navigation avoid collection lookups; string configurations remain supported',async()=>{
  const ordinary={...filter,config:{navCollections:false}};
  const disabled={...filter,isEnabled:false};
  const rows=await resolveCollectionNavigation([ordinary,disabled],async()=>{throw Error('Unexpected lookup')});
  assert.equal(rows[0],ordinary);assert.equal(rows[1],disabled);
  assert.equal(isCollectionNavigation({...filter,config:JSON.stringify(filter.config)}),true);
  for(const config of ['null','[]','{bad',null])assert.equal(isCollectionNavigation({...filter,config}),false);
  assert.deepEqual(navigationCollectionTitles({useManualValues:true,manualValues:['Formal','Formal']}),['Formal']);
});

test('only saved navigation pages lacking resolved links are rejected for rebuilding',()=>{
  assert.equal(hasUsableCollectionNavigation({settings:[filter]}),false);
  assert.equal(hasUsableCollectionNavigation({settings:[{...filter,config:{...filter.config,navigationLinks:[]}}]}),true);
  assert.equal(hasUsableCollectionNavigation({settings:[{...filter,isEnabled:false}]}),true);
  assert.equal(hasUsableCollectionNavigation({settings:[{...filter,config:{navCollections:false}}]}),true);
});

test('actual API resolves shop-scoped assigned links even when their collections have no products in the current results',async()=>{
  const fixture=await createLoadingServer();
  try{
    Object.assign(fixture.state,{noPins:true,noMerchandising:true,filterSettings:[filter],collectionLinks:[
      {shop:'headless-fixture.myshopify.com',title:'Formal',handle:'designer-evening'},
      {shop:'other.myshopify.com',title:'Summer',handle:'wrong-store'},
    ]});
    const response=await fixture.load(new Request('http://fixture/api/filter?shop=headless-fixture.myshopify.com&collectionHandle=fixture&sortBy=manual&page=1&limit=25'));
    const body=await response.json();
    assert.equal(response.status,200);assert.equal(body.totalCount,30);assert.equal(body.products.length,25);
    assert.deepEqual(body.settings[0].config.navigationLinks,[{label:'Formal',handle:'designer-evening'}]);
    assert.ok(fixture.facetRequests.every(query=>!query.facets?.includes('collection_titles')));
  }finally{fixture.dispose();}
});

test('ordinary Collection filters request and return collection-wide collection facets',async()=>{
  const fixture=await createLoadingServer();
  try{
    Object.assign(fixture.state,{noPins:true,noMerchandising:true,filterSettings:[{...filter,config:{navCollections:false}}]});
    const response=await fixture.load(new Request('http://fixture/api/filter?shop=headless-fixture.myshopify.com&collectionHandle=fixture&sortBy=manual&page=1&limit=25'));
    const body=await response.json();
    assert.deepEqual(body.facets.collections,[{value:'Fixture collection',label:'Fixture collection',count:30}]);
    assert.ok(fixture.facetRequests.some(query=>query.facets?.includes('collection_titles')));
  }finally{fixture.dispose();}
});

test('navigation tooltip distinguishes destinations, product filtering and filter-group page assignment',()=>{
  assert.match(navigationCollectionsHelp,/open the selected collection page/);
  assert.match(navigationCollectionsHelp,/rather than filtering/);
  assert.match(navigationCollectionsHelp,/manual values are not required/);
  assert.match(navigationCollectionsHelp,/pages assigned to this filter group/);
});
