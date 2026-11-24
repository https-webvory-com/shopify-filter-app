import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadingServer} from '../collection-loading/server.mjs';
import {hasCurrentCollectionFacetScope,withoutLegacyCollectionFacets} from '../../app/utils/collectionFacetScope.js';
import {collectionCardsResponse} from '../../app/utils/collectionCards.js';
import {visibleCollectionFacets} from '../../app/utils/collectionBootstrap.js';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8'),browser={};
vm.runInNewContext(source.slice(source.indexOf('  function decodeCollectionResponse('),source.indexOf('  async function fetchCollectionResponse('))+'\nthis.decode=decodeCollectionResponse;',browser);
const decode=value=>JSON.parse(JSON.stringify(browser.decode(value)));

test('outside Include products retain their cards but cannot add collection choices that return no matches',async()=>{
 const f=await createLoadingServer();
 try{
  f.state.delay=0;f.state.noPins=true;f.state.enforceCollections=true;f.state.ruleConditions=[{action:'Include',field:'Tags',operator:'contains',value:'TopWedding'}];
  f.state.filterSettings=[{id:'color',filterType:'option',filterKey:'Color',label:'Color',isEnabled:true,config:{}}];
  f.documents.splice(6);
  for(const [i,doc]of f.documents.entries()){
   const color=['White','Ivory','Champagne','Silver','Black','White'][i];doc.options=[{name:'Color',values:[color]}];doc.variantPrices[0].option1=color;doc.variantPrices[0].marketPrices={US:{price:100,currency:'USD'}};
   if(i>=4){doc.collections=['gid://shopify/Collection/2'];doc.tags=['TopWedding'];}
  }
  const url='http://fixture/api/filter?shop=headless-fixture.myshopify.com&country=US&locale=en&collectionHandle=fixture&sortBy=best-selling&page=1&limit=25&responseProfile=collection-v1';
  let response,body;for(let i=0;i<10;i++){response=await f.load(new Request(url));body=decode(await response.json());if(response.status!==202)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(response.status,200,body.error);assert.equal(body.totalCount,6,'merchant Include membership remains unchanged');
  assert.equal(body.products.length,6);assert.ok(body.products.some(p=>p.options[0].values.includes('Black')));
  assert.deepEqual(body.facets.options.Color.map(item=>item.value).sort(),['Champagne','Ivory','Silver','White']);
  assert.equal(body.facets.options.Color.find(item=>item.value==='White').count,1,'outside White does not inflate the selectable collection');
  assert.equal(body.facets.collectionScopeVersion,1);
  const sorted=await f.load(new Request(url.replace('sortBy=best-selling','sortBy=title-ascending'))),sortedBody=decode(await sorted.json());
  assert.equal(sorted.status,200,sortedBody.error);assert.equal(sortedBody.totalCount,6,'facet scope cannot alter direct-sort pagination');
  assert.deepEqual(new Set(sortedBody.products.map(p=>p.id)),new Set(body.products.map(p=>p.id)));
  assert.deepEqual(sortedBody.facets.options.Color.map(item=>item.value).sort(),['Champagne','Ivory','Silver','White']);
  let filtered,selected;for(let i=0;i<10;i++){filtered=await f.load(new Request(url+'&options[Color][]=Black&priceFilterVersion=1&priceSortRate=1&priceCurrency=USD'));selected=decode(await filtered.json());if(filtered.status!==202)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(filtered.status,200,selected.error);assert.equal(selected.totalCount,0);
  for(let i=0;i<10;i++){filtered=await f.load(new Request(url+'&options[Color][]=White&priceFilterVersion=1&priceSortRate=1&priceCurrency=USD'));selected=decode(await filtered.json());if(filtered.status!==202)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(filtered.status,200,selected.error);assert.equal(selected.totalCount,1);assert.equal(selected.products[0].id,'gid://shopify/Product/1');
 }finally{f.dispose();}
});

test('legacy Include facets are discarded while complete verified cards keep rendering',async()=>{
 const payload={products:[{id:'1',title:'White dress'}],totalCount:1,settings:[],globalSettings:{},facets:{options:{Color:[{value:'Black',count:1}]}},debug:{activeRuleConditions:[{action:'Include'}]},cfpCards:{published:true,facetsReady:true}};
 assert.equal(hasCurrentCollectionFacetScope(payload),false);
 const clean=withoutLegacyCollectionFacets(payload);assert.equal(clean.facets,undefined);assert.equal(clean.products,payload.products);assert.equal(clean.totalCount,1);assert.equal(clean.cfpCards.version,2);assert.equal(clean.cfpCards.published,false);
 const response=await collectionCardsResponse(payload,'published',new Request('http://fixture/api/filter?responseProfile=collection-cards-v1'));
 const body=await response.json();assert.equal(body.products.length,1);assert.equal(body.facets,undefined);assert.equal(body.cfpCards.version,2);
 const current={...payload,facets:{...payload.facets,collectionScopeVersion:1}};assert.equal(hasCurrentCollectionFacetScope(current),true);assert.equal(withoutLegacyCollectionFacets(current),current);
 assert.equal(visibleCollectionFacets(current.facets,[]).collectionScopeVersion,1);
});
