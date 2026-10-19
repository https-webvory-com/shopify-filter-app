import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadingServer} from '../collection-loading/server.mjs';
import {processCollectionRankingJob} from '../../app/utils/processCollectionRankingJob.js';

const url='http://fixture/api/filter?locale=en&shop=headless-fixture.myshopify.com&country=US&collectionHandle=fixture&sortBy=best-selling&page=1&limit=25';
const ids=body=>body.products.map(product=>product.id);

test('a catalog worker context prepares the actual loader before the collection has any shopper visit',async()=>{
 const f=await createLoadingServer();f.state.hold=true;
 try{
  assert.equal(f.state.builds,0);
  await processCollectionRankingJob({name:'COLLECTION_RANKING_CATALOG',data:{shop:'headless-fixture.myshopify.com',record:{url,collectionId:'1'}}},
   {warm:async(_shop,_ids,record)=>{const response=await f.load(new Request(record.url),{rankingWarmup:true});assert.equal(response.status,202);}});
  assert.equal(f.trace.facetQueries,0);assert.equal(f.trace.hydrations,0);await f.prepareLast();
  const firstVisit=await f.load(new Request(url));assert.equal(firstVisit.status,200);
  const body=await firstVisit.json();assert.equal(body.products.length,25);assert.equal(body.totalCount,30);assert.equal(f.state.builds,1);
 }finally{f.dispose();}
});

test('pending first loads and worker warmups do not fetch facets or hydrate cards',async()=>{
 const f=await createLoadingServer();f.state.hold=true;
 try{
  const pending=await f.load(new Request(url));assert.equal(pending.status,202);
  assert.deepEqual(f.trace,{facetQueries:0,hydrations:0,documentBatches:0,documentCalls:0,candidateBrowses:0});
  await f.prepareLast();
  const warm=await f.load(new Request(url),{rankingWarmup:true});
  assert.deepEqual(await warm.json(),{warmup:true});assert.deepEqual(f.trace,{facetQueries:0,hydrations:0,documentBatches:0,documentCalls:0,candidateBrowses:0});
  const ready=await f.load(new Request(url));assert.equal(ready.status,200);
  const body=await ready.json();assert.equal(body.products.length,25);assert.equal(body.totalCount,30);
  assert.ok(f.trace.facetQueries>0);assert.equal(f.trace.hydrations,25);
  // Only facet queries remain; product hits and exact count come from the
  // frozen ranking, not an additional ordinary sorted search.
  assert.equal(f.trace.facetQueries,2);
  for(const query of f.facetRequests){assert.ok(query.facets);assert.equal(query.limit,0);assert.equal(query.hitsPerPage,undefined);}
 }finally{f.dispose();}
});

test('an order refresh renders a complete usable first page and preserves existing pagination tokens',async()=>{
 const f=await createLoadingServer();f.state.hold=true;
 try{
  await f.load(new Request(url));await f.prepareLast();
  const original=await(await f.load(new Request(url))).json();
  const pageTwo=url.replace('page=1','page=2')+'&rankingToken='+original.rankingToken;
  const before=await(await f.load(new Request(pageTwo))).json();
  f.state.orderVersion=1;
  const during=await f.load(new Request(url));assert.equal(during.status,200);
  const usable=await during.json();assert.deepEqual(ids(usable),ids(original));assert.equal(usable.totalCount,original.totalCount);
  await f.prepareLast();
  const fresh=await(await f.load(new Request(url))).json();
  assert.notDeepEqual(ids(fresh),ids(original));assert.equal(fresh.totalCount,30);
  assert.deepEqual(ids(await(await f.load(new Request(pageTwo))).json()),ids(before));
  assert.equal(new Set([...ids(original),...ids(before)]).size,30);
 }finally{f.dispose();}
});

test('cards are available without facet work and the same frozen token retrieves complete facets and page two',async()=>{
 const f=await createLoadingServer();f.state.hold=true;
 try{
  await f.load(new Request(url));await f.prepareLast();
  const baseline=await(await f.load(new Request(url))).json(),before=f.trace.facetQueries;
  const cards=await(await f.load(new Request(url+'&responseProfile=collection-cards-v1'))).json();
  assert.equal(cards.cfpCards.version,1);assert.equal(cards.facets,undefined);assert.equal(f.trace.facetQueries,before);
  assert.deepEqual(cards.products,baseline.products);assert.equal(cards.rankingToken,baseline.rankingToken);
  const facets=await(await f.load(new Request(url+'&rankingToken='+cards.rankingToken))).json();
  assert.deepEqual(facets.products,cards.products);assert.deepEqual(facets.facets,baseline.facets);
  const next=await(await f.load(new Request(url.replace('page=1','page=2')+'&rankingToken='+cards.rankingToken))).json();
  assert.equal(new Set([...ids(cards),...ids(next)]).size,30);
 }finally{f.dispose();}
});

test('background card snapshots avoid sessions and facets until the first browser and validate current products on reuse',async()=>{
 const f=await createLoadingServer();f.state.hold=true;f.state.cardSnapshots=true;
 try{
  await f.load(new Request(url));await f.prepareLast();
  const warmed=await f.load(new Request(url+'&responseProfile=collection-cards-v1'),{rankingWarmup:true,rankingCardsPrecompute:true});
  assert.equal(warmed.headers.get('X-CFP-Collection-Cards'),'stored');assert.equal(f.trace.facetQueries,0);assert.equal(f.sessionCount(),0);
  const builds=f.state.builds;
  const probe=await f.load(new Request(url+'&responseProfile=collection-cards-v1'),{rankingWarmup:true,rankingCardsPrecompute:true});
  assert.equal(probe.headers.get('X-CFP-Collection-Cards'),'hit');assert.equal((await probe.json()).rankingToken,undefined);
  assert.equal(f.sessionCount(),0);assert.equal(f.trace.facetQueries,0);assert.equal(f.state.builds,builds);
  const before=f.trace.hydrations,response=await f.load(new Request(url+'&responseProfile=collection-cards-v1'));
  assert.equal(response.headers.get('X-CFP-Collection-Cards'),'hit');const cards=await response.json();assert.equal(cards.products.length,25);assert.notEqual(cards.rankingToken,'background-cards');
  assert.equal(f.trace.hydrations,before+25);assert.equal(f.trace.facetQueries,0);assert.equal(f.sessionCount(),1);
  const second=await f.load(new Request(url.replace('page=1','page=2')+'&rankingToken='+cards.rankingToken));assert.equal(second.status,200);
 }finally{f.dispose();}
});
