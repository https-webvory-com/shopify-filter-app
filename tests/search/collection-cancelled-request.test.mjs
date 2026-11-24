import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadingServer} from '../collection-loading/server.mjs';

const base='https://fixture/api/filter?shop=headless-fixture.myshopify.com&country=US&locale=en&collectionHandle=fixture&sortBy=best-selling&page=1&limit=25';
test('an already cancelled collection request does not read products, query facets or start ranking',async()=>{
 const fixture=await createLoadingServer();
 try{
  const controller=new AbortController();controller.abort();
  const response=await fixture.load(new Request(base,{signal:controller.signal}));
  assert.equal(response.status,499);assert.equal(fixture.state.builds,0);assert.equal(fixture.sessionCount(),0);
  assert.ok(Object.values(fixture.trace).every(value=>value===0));
 }finally{fixture.dispose();}
});

test('a superseded multi-filter request finishes its shared eligibility read without queuing ranking or facet work',async()=>{
 const fixture=await createLoadingServer();
 try{
  fixture.state.hold=true;const controller=new AbortController();let reads=0;
  const product=fixture.documents[0],options=product.options;
  Object.defineProperty(product,'options',{enumerable:true,configurable:true,get(){reads++;controller.abort();return options;}});
  const response=await fixture.load(new Request(base+'&priceFilterVersion=1&priceSortRate=1&priceCurrency=USD&responseProfile=fast-cards-v1&options[Color][]=Blue&options[Size][]=M&vendor[]=Fixture&price[]=0:1000',{signal:controller.signal}));
  assert.ok(reads>0);assert.equal(controller.signal.aborted,true);assert.equal(response.status,499);
  assert.equal(fixture.state.builds,0);assert.equal(fixture.sessionCount(),0);assert.equal(fixture.trace.facetQueries,0);
 }finally{fixture.dispose();}
});
