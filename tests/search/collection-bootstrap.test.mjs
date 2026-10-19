import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';
import {collectionConfiguration,configurationResponse,visibleCollectionFacets} from '../../app/utils/collectionBootstrap.js';
import {packCollectionResponse} from '../../app/utils/collectionResponse.js';
import {createLoadingServer} from '../collection-loading/server.mjs';

const settings=[{isEnabled:true,filterType:'tags',config:{prefix:'Color:',manualValues:['Blue'],useManualValues:true}},{isEnabled:true,filterType:'tag',config:JSON.stringify({prefix:'Style:'})},{isEnabled:true,filterType:'option',filterKey:'Size'},{isEnabled:false,filterType:'vendor'},{isEnabled:true,filterType:'price'}];
const facets={tags:[{value:'Color:Blue',count:9},{value:'color:Red',count:4},{value:'Style:Long',count:5},{value:'Internal:Flag',count:10}],vendors:[{value:'Vendor',count:10}],options:{Size:[{value:'M',count:7}],Color:[{value:'Blue',count:9}]},priceRanges:{minLimit:1,maxLimit:100}};
const payload={products:[{id:'1',variants:[{available:true}]}],totalCount:10,rankingToken:'same',settings,facets,mergedValues:[{targetValue:'Blue',values:['Navy']}],globalSettings:{showProductCount:true}};
const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
function browserHelpers(fetch){const ctx={fetch,URL,AbortController,setTimeout,clearTimeout};vm.runInNewContext(source.slice(source.indexOf('  function decodeCollectionResponse('),source.indexOf('  async function takeEarlyCollectionResponse('))+'\nthis.decode=decodeCollectionResponse;this.complete=completeCollectionResponse;',ctx);return ctx;}
const json=value=>JSON.parse(JSON.stringify(value));

test('only enabled facet consumers travel, preserving prefix unions, manual inputs, counts and ranges',()=>{
 const result=visibleCollectionFacets(facets,settings);assert.deepEqual(result.tags,facets.tags.slice(0,3));assert.deepEqual(result.options,{Size:facets.options.Size});assert.equal(result.priceRanges,facets.priceRanges);assert.equal(result.vendors,undefined);
 assert.equal(visibleCollectionFacets(facets,[{isEnabled:true,type:'unknown'}]),facets);
 assert.equal(visibleCollectionFacets(facets,[{isEnabled:true,type:'tags',config:'{bad'}]),facets);
 assert.deepEqual(visibleCollectionFacets(facets,[...settings,{isEnabled:true,type:'tag'}]).tags,facets.tags);
 assert.deepEqual(facets.tags.length,4);
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
