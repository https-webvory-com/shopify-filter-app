import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadingServer} from '../collection-loading/server.mjs';

const url='http://fixture/api/filter?locale=en&shop=headless-fixture.myshopify.com&country=US&collectionHandle=fixture&sortBy=best-selling&page=1&limit=25';
const ids=body=>body.products.map(product=>product.id);

test('pending first loads and worker warmups do not fetch facets or hydrate cards',async()=>{
 const f=await createLoadingServer();f.state.hold=true;
 try{
  const pending=await f.load(new Request(url));assert.equal(pending.status,202);
  assert.deepEqual(f.trace,{facetQueries:0,hydrations:0});
  await f.prepareLast();
  const warm=await f.load(new Request(url),{rankingWarmup:true});
  assert.deepEqual(await warm.json(),{warmup:true});assert.deepEqual(f.trace,{facetQueries:0,hydrations:0});
  const ready=await f.load(new Request(url));assert.equal(ready.status,200);
  const body=await ready.json();assert.equal(body.products.length,25);assert.equal(body.totalCount,30);
  assert.ok(f.trace.facetQueries>0);assert.equal(f.trace.hydrations,25);
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
