import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import vm from 'node:vm';
import {createCollectionResponseCache,packCollectionResponse,isPublicCollectionResponse} from '../../app/utils/collectionResponse.js';
import {createLoadingServer} from '../collection-loading/server.mjs';

const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
const context={};vm.runInNewContext(source.slice(source.indexOf('  function decodeCollectionResponse('),source.indexOf('  async function fetchCollectionResponse('))+'\nthis.decode=decodeCollectionResponse;',context);
const decode=value=>JSON.parse(JSON.stringify(context.decode(value)));
const url='https://app.test/api/filter?shop=fixture.myshopify.com&locale=en&country=IN&collectionHandle=petite&page=1&limit=25&sortBy=best-selling&responseProfile=collection-v1';
const payload={rankingToken:'frozen-token',products:[{id:'1',variants:[{id:'v1',available:true}]}],totalCount:100,settings:[{config:{manualValues:['a','b'],empty:[],enabled:false}}],mergedValues:[{targetValue:'Blue',values:['Navy']}],facets:{tags:Array.from({length:300},(_,i)=>({value:'Tag '+i,count:i})),availability:{inStock:100,outOfStock:0}}};
function fixture(options={}){let state=['0','0'],clock=0;const cache=createCollectionResponseCache({readRevision:async()=>state,now:()=>clock,...options});return{cache,setState:value=>state=value,advance:ms=>clock+=ms,begin:(request=new Request(url),extra={})=>cache.begin({request,shop:'fixture.myshopify.com',configurationRevision:'0',rankingToken:'frozen-token',...extra})};}

test('the actual storefront decoder restores all compact metadata and leaves product/variant/order data identical',()=>{
 const wire=packCollectionResponse(payload);assert.deepEqual(decode(wire),payload);
 assert.ok(JSON.stringify(wire).length<JSON.stringify(payload).length);
 assert.deepEqual(wire.products,payload.products);assert.equal(wire.rankingToken,payload.rankingToken);
 for(const value of [[],null,[{a:1},{b:2}],['t',['a'],[[1]]],{nested:[{x:null},{x:false},{x:0}],empty:{}}]){
  const input={products:[],facets:value};assert.deepEqual(decode(packCollectionResponse(input)),input);
 }
 const hostile=JSON.parse('{"__proto__":{"flag":true},"constructor":"literal"}');
 assert.deepEqual(decode(packCollectionResponse({facets:hostile})),{facets:hostile});assert.equal({}.flag,undefined);
});
test('anonymous ready first pages reuse a bounded response and answer matching validators with 304',async()=>{
 const f=fixture(),first=await(await f.begin()).finish(payload);assert.equal(first.status,200);assert.match(first.headers.get('Cache-Control'),/must-revalidate/);
 const etag=first.headers.get('ETag'),cached=await f.begin(new Request(url,{headers:{'If-None-Match':etag}}));
 assert.equal(cached.response.status,304);assert.equal(await cached.response.text(),'');assert.equal(cached.response.headers.get('X-CFP-Collection-Response'),'hit');
 const full=await f.begin();assert.deepEqual(decode(await full.response.json()),payload);
});
test('configuration, product and ranking changes cannot reuse the previous response',async()=>{
 for(const kind of ['config','products','ranking']){const f=fixture();await(await f.begin()).finish(payload);
  if(kind==='config')f.setState(['1','0']);if(kind==='products')f.setState(['0','1']);
  const next=await f.begin(new Request(url),kind==='config'?{configurationRevision:'1'}:kind==='ranking'?{rankingToken:'new-ranking'}:{});
  assert.equal(next.response,undefined,kind);
 }
});
test('updates during a response build prevent caching; revision outages fail closed without hiding products',async()=>{
 const f=fixture();const lease=await f.begin();f.setState(['0','1']);const response=await lease.finish(payload);
 assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(f.cache.stats().entries,0);assert.deepEqual(decode(await response.json()),payload);
 for(const readRevision of [async()=>{throw Error('offline');},()=>new Promise(()=>{})]){
  const fallback=fixture({readRevision,revisionTimeoutMs:5});const r=await(await fallback.begin()).finish(payload);
  assert.equal(r.headers.get('ETag'),null);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.deepEqual(decode(await r.json()),payload);
 }
});
test('an invalidation during a cache hit rejects the cached payload',async()=>{
 let reads=0;const f=fixture({readRevision:async()=>++reads===4?['0','1']:['0','0']});
 await(await f.begin()).finish(payload);const next=await f.begin();assert.equal(next.response,undefined);
});

test('a cache hit still validates current cards and rejects missed product signals or missing documents',async()=>{
 const f=fixture();let current=true;
 const validate=async fingerprint=>current&&fingerprint==='cards-v1';
 await(await f.begin(new Request(url),{validate})).finish(payload,'cards-v1');
 current=false;assert.equal((await f.begin(new Request(url),{validate})).response,undefined);
 await(await f.begin(new Request(url),{validate})).finish(payload,'cards-v1');
 await assert.rejects(f.begin(new Request(url),{validate:async()=>{throw Error('Collection ranking session expired; product eligibility changed');}}),/eligibility changed/);
 assert.equal(f.cache.stats().entries,0);
});
test('customer, search, filters, later pages, tokens and unknown contexts never get a cacheable response',async()=>{
 for(const extra of ['customer_tags=VIP','q=dress','options[Color][]=Blue','rankingToken=old','unknown=1','page=2']){
  const request=new Request(url+'&'+extra);assert.equal(isPublicCollectionResponse(request),false,extra);
  const f=fixture();const response=await(await f.begin(request)).finish(payload);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(f.cache.stats().entries,0);
 }
});
test('market and locale boundaries stay separate and response storage has byte, entry and lifetime bounds',async()=>{
 const f=fixture({maxEntries:2,maxBytes:50000});await(await f.begin()).finish(payload);
 for(const change of [['country','US'],['locale','fr']]){const u=new URL(url);u.searchParams.set(...change);const lease=await f.begin(new Request(u));assert.equal(lease.response,undefined);await lease.finish(payload);}
 assert.equal(f.cache.stats().entries,2);assert.ok(f.cache.stats().bytes<=50000);
 f.advance(15001);assert.equal((await f.begin()).response,undefined);
 const tiny=fixture({maxEntryBytes:10});await(await tiny.begin()).finish(payload);assert.equal(tiny.cache.stats().entries,0);
});

test('the actual route bypasses repeated facet queries while validating current cards and retaining frozen page-two results',async()=>{
 const f=await createLoadingServer();f.state.hold=true;
 const firstUrl='http://fixture/api/filter?locale=en&shop=headless-fixture.myshopify.com&country=US&collectionHandle=fixture&sortBy=best-selling&page=1&limit=25&responseProfile=collection-v1';
 try{
  assert.equal((await f.load(new Request(firstUrl))).status,202);await f.prepareLast();
  const first=await f.load(new Request(firstUrl)),etag=first.headers.get('ETag'),body=decode(await first.json());
  const trace={...f.trace};assert.equal(body.products.length,25);assert.ok(etag);
  const cached=await f.load(new Request(firstUrl,{headers:{'If-None-Match':etag}}));assert.equal(cached.status,304);assert.equal(f.trace.facetQueries,trace.facetQueries);assert.equal(f.trace.hydrations,trace.hydrations+25);assert.equal(f.trace.documentBatches,trace.documentBatches+1);assert.equal(f.trace.documentCalls,trace.documentCalls);
  const pageTwo=new URL(firstUrl);pageTwo.searchParams.set('page','2');pageTwo.searchParams.set('rankingToken',body.rankingToken);
  const second=await f.load(new Request(pageTwo));assert.equal(second.headers.get('Cache-Control'),'no-store');
  const later=decode(await second.json());assert.equal(new Set([...body.products,...later.products].map(p=>p.id)).size,30);
  f.state.orderVersion=1;await f.load(new Request(firstUrl));await f.prepareLast();const changed=decode(await(await f.load(new Request(firstUrl))).json());
  assert.notEqual(changed.rankingToken,body.rankingToken);assert.notDeepEqual(changed.products.map(p=>p.id),body.products.map(p=>p.id));
  const frozen=decode(await(await f.load(new Request(pageTwo))).json());assert.deepEqual(frozen.products.map(p=>p.id),later.products.map(p=>p.id));
 }finally{f.dispose();}
});
