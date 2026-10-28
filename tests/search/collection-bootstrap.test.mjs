import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {collectionConfiguration,configurationResponse,visibleCollectionFacets} from '../../app/utils/collectionBootstrap.js';
import {packCollectionResponse} from '../../app/utils/collectionResponse.js';
import {createLoadingServer} from '../collection-loading/server.mjs';

const settings=[{isEnabled:true,filterType:'tags',config:{prefix:'Color:',manualValues:['Blue'],useManualValues:true}},{isEnabled:true,filterType:'tag',config:JSON.stringify({prefix:'Style:'})},{isEnabled:true,filterType:'option',filterKey:'Size'},{isEnabled:false,filterType:'vendor'},{isEnabled:true,filterType:'price'}];
const facets={tags:[{value:'Color:Blue',count:9},{value:'color:Red',count:4},{value:'Style:Long',count:5},{value:'Internal:Flag',count:10}],vendors:[{value:'Vendor',count:10}],options:{Size:[{value:'M',count:7}],Color:[{value:'Blue',count:9}]},priceRanges:{minLimit:1,maxLimit:100}};
const payload={products:[{id:'1',variants:[{available:true}]}],totalCount:10,rankingToken:'same',settings,facets,mergedValues:[{targetValue:'Blue',values:['Navy']}],globalSettings:{showProductCount:true}};
const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
function browserHelpers(fetch){const ctx={fetch,URL,AbortController,setTimeout,clearTimeout,templateName:'collection'};vm.runInNewContext(source.slice(source.indexOf('  function decodeCollectionResponse('),source.indexOf('  async function takeEarlyCollectionResponse('))+'\nthis.decode=decodeCollectionResponse;this.complete=completeCollectionResponse;',ctx);return ctx;}
const json=value=>JSON.parse(JSON.stringify(value));

test('only enabled facet consumers travel, preserving prefix unions, manual inputs, counts and ranges',()=>{
 const result=visibleCollectionFacets(facets,settings);assert.deepEqual(result.tags,[facets.tags[0],facets.tags[2]]);assert.deepEqual(result.options,{Size:facets.options.Size});assert.equal(result.priceRanges,facets.priceRanges);assert.equal(result.vendors,undefined);
 assert.equal(visibleCollectionFacets(facets,[{isEnabled:true,type:'unknown'}]),facets);
 assert.equal(visibleCollectionFacets(facets,[{isEnabled:true,type:'tags',config:'{bad'}]),facets);
 assert.deepEqual(visibleCollectionFacets(facets,[...settings,{isEnabled:true,type:'tag'}]).tags,facets.tags);
 assert.deepEqual(facets.tags.length,4);
});

test('manual values trim shared facets only when no enabled group needs the removed value',()=>{
 const values={tags:[{value:'Sale',count:8},{value:'SALE',count:2},{value:'Occasion_Wedding',count:5},{value:'Internal',count:20},{value:'Size_ M ',count:3},{value:'Size_L',count:4}]};
 const groups=[{isEnabled:true,type:'tag',config:{useManualValues:true,manualValues:[' sale '],excludedValues:['SALE']}},{isEnabled:true,type:'tag',config:{prefix:'Occasion_'}},{isEnabled:true,type:'tag',config:{prefix:'Size_',useManualValues:true,manualValues:['M']}}];
 const projected=visibleCollectionFacets(values,groups);assert.deepEqual(projected.tags,[values.tags[0],values.tags[2],values.tags[4]]);
 assert.deepEqual(visibleCollectionFacets(values,[...groups,{isEnabled:true,type:'tag'}]).tags,values.tags);
 assert.deepEqual(visibleCollectionFacets(values,[{isEnabled:true,type:'tag',config:{useManualValues:true,manualValues:[]}}]).tags,values.tags);
 assert.equal(visibleCollectionFacets(values,[{isEnabled:true,type:'tag',config:{manualValues:[null]}}]),values);
 assert.equal(values.tags.length,6);
});
test('configuration and products are separated with a content version and reassemble all product/rendering settings',async()=>{
 const wire=packCollectionResponse(payload,{profile:'collection-v2'}),config=collectionConfiguration(payload),helpers=browserHelpers(()=>{throw Error('Unexpected fallback')});
 assert.equal(wire.settings,undefined);assert.equal(wire.mergedValues,undefined);assert.equal(wire.globalSettings,undefined);assert.equal(wire.facets,undefined);assert.deepEqual(wire.products,payload.products);assert.equal(wire.rankingToken,'same');
 const decoded=helpers.decode(wire),restored=await helpers.complete(decoded,'https://app/api/filter?responseProfile=collection-v2',new AbortController().signal,Promise.resolve({configurationVersion:config.version,configuration:config.configuration}));
 assert.deepEqual(json(restored),{...payload,facets:visibleCollectionFacets(facets,settings)});
 const first=configurationResponse(new Request('https://app/config'),payload),cached=configurationResponse(new Request('https://app/config',{headers:{'If-None-Match':first.headers.get('ETag')}}),payload);
 assert.equal(cached.status,304);assert.equal(await cached.text(),'');assert.match(first.headers.get('Cache-Control'),/must-revalidate/);
 assert.notEqual(collectionConfiguration({...payload,globalSettings:{showProductCount:false}}).version,config.version);
});
test('missing or mismatched parallel configuration recovers through one full compatible product request',async()=>{
 for(const bootstrap of [null,{configurationVersion:'old',configuration:{settings:[]}}]){
  const urls=[],helpers=browserHelpers(async url=>{urls.push(url);return Response.json(packCollectionResponse(payload));});
  const result=await helpers.complete(helpers.decode(packCollectionResponse(payload,{profile:'collection-v2'})),'https://app/api/filter?responseProfile=collection-v2',new AbortController().signal,Promise.resolve(bootstrap));
  assert.deepEqual(json(result),payload);assert.equal(urls.length,1);assert.equal(new URL(urls[0]).searchParams.get('responseProfile'),'collection-v1');
 }
});
test('actual bootstrap route never waits for ranking, scans facets or hydrates cards; warmup serves the first visitor ready',async()=>{
 const f=await createLoadingServer();f.state.hold=true;
 const url='http://fixture/api/filter?shop=headless-fixture.myshopify.com&collectionHandle=fixture&locale=en&country=US&sortBy=best-selling&page=1&limit=25&responseProfile=collection-config-v1';
 try {
  const response=await f.load(new Request(url)),config=await response.json();assert.equal(response.status,200);assert.ok(config.configurationVersion);assert.equal(f.state.builds,0);assert.equal(f.trace.facetQueries,0);assert.equal(f.trace.hydrations,0);
  assert.equal((await f.load(new Request(url,{headers:{'If-None-Match':response.headers.get('ETag')}}))).status,304);
  const products=url.replace('collection-config-v1','collection-v2');assert.equal((await f.load(new Request(products),{rankingWarmup:true})).status,202);await f.prepareLast();
  const ready=await f.load(new Request(products));assert.equal(ready.status,200);const data=await ready.json();assert.equal(data.products.length,25);assert.equal(data.cfpConfiguration.version,config.configurationVersion);assert.equal(data.settings,undefined);assert.equal(data.globalSettings,undefined);
  assert.equal(f.state.builds,1);
  const privateUrl=url+'&customer_tags=VIP';assert.equal((await f.load(new Request(privateUrl))).status,400);
 }finally{f.dispose();}
});

test('a stalled configuration response remains bounded by the request timeout and respects cancellation',async()=>{
 let timeout;
 const helpers=browserHelpers(async(url,{signal})=>{
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(new URL(url).searchParams.get('responseProfile')==='collection-config-v1')return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
  return Response.json(packCollectionResponse(payload,{profile:'collection-v2'}));
 });
 helpers.setTimeout=callback=>{timeout=callback;return 1;};helpers.clearTimeout=()=>{};
 const controller=new AbortController(),request=helpers.fetchCollectionResponse('https://app/api/filter?responseProfile=collection-v2',controller.signal);
 await new Promise(resolve=>setImmediate(resolve));timeout();await assert.rejects(request,{name:'AbortError'});assert.equal(controller.signal.aborted,false);
});
test('search results allow a slow first response without changing collection timeout',async()=>{
 const delays=[],helpers=browserHelpers(async()=>Response.json(payload));
 helpers.setTimeout=(_callback,delay)=>{delays.push(delay);return 1;};helpers.clearTimeout=()=>{};
 const signal=new AbortController().signal,url='https://app/api/filter?shop=fixture.myshopify.com&q=cocktail+dress';
 await helpers.fetchCollectionResponse(url,signal);
 assert.equal(delays.at(-1),30000);
 helpers.templateName='search';
 await helpers.fetchCollectionResponse(url,signal);
 assert.equal(delays.at(-1),60000);
});
test('first-page request recovers after temporary deployment errors without changing the 30-second request timeout',async()=>{
 let calls=0;
 const helpers=browserHelpers(async()=>{
  calls++;
  return calls<3 ? {status:503,json:async()=>({error:'Service temporarily unavailable'})} : {status:200,json:async()=>payload};
 });
 const result=await helpers.fetchCollectionResponseWithRecovery('https://app/api/filter?responseProfile=collection-v1',new AbortController().signal);
 assert.equal(result.status,200);assert.equal((await result.json()).products.length,1);assert.equal(calls,3);
});
test('first-page recovery does not retry permanent API errors',async()=>{
 let calls=0;
 const helpers=browserHelpers(async()=>{calls++;return {status:400,json:async()=>({error:'Invalid filter'})};});
 await assert.rejects(helpers.fetchCollectionResponseWithRecovery('https://app/api/filter?responseProfile=collection-v1',new AbortController().signal),/Invalid filter/);
 assert.equal(calls,1);
});
