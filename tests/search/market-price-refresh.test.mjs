import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshProductMarketPrices} from '../../app/utils/refreshProductMarketPrices.js';
import {saveProductMarketPrices} from '../../app/utils/saveProductMarketPrices.js';
import {loadModule} from './helpers/search-ranking.mjs';

function fixture({unchanged=false,currency='INR',missing=false,failPhase}={}){
 const shop='fixture.myshopify.com',productId='gid://shopify/Product/1',events=[],patches=[];
 let saved={id:productId,shop,tags:['Sale'],collections:[{collectionId:'gid://shopify/Collection/7'}],variants:[1,2].map(n=>({id:'gid://shopify/ProductVariant/'+n,price:n*10,available:true,marketPrices:{GB:{price:n*10,currency:'GBP'},IN:{currency:'INR',compareAtPrice:n*1300,price:n*(unchanged?1100:1000)}}}))};
 let failed=false;
 const record=name=>{events.push(name);if(name===failPhase&&!failed){failed=true;throw Error(name+' failed');}};
 const job={data:{shop,productId,country:'IN',currency:'INR'},updateData:async data=>{job.data=data;events.push('checkpoint');}};
 const deps={
  read:async(s,id)=>{assert.equal(s,shop);assert.equal(id,productId);return structuredClone(saved);},
  admin:{graphql:async(query,{variables})=>{
   assert.match(query,/country: IN/);assert.doesNotMatch(query,/country: GB/);assert.equal(variables.id,productId);
   const n=variables.cursor?2:1;
   return {json:async()=>({data:{product:{id:productId,variants:{nodes:missing&&n===2?[]:[{id:'gid://shopify/ProductVariant/'+n,cfpMarket_IN:{price:{amount:String(n*1100),currencyCode:currency},compareAtPrice:{amount:String(n*1300),currencyCode:currency}}}],pageInfo:{hasNextPage:n===1,endCursor:'next'}}}}})};
  }},
  save:async(before,prices,country)=>{record('save');assert.equal(before.id,productId);const byId=new Map(prices.map(v=>[v.id,v.price]));saved.variants.forEach(v=>v.marketPrices[country]=byId.get(v.id));},
  index:async(s,id,variants,fields)=>{record('index');patches.push({s,id,variants,fields});return 99;},
  search:async(s,ids,task)=>{assert.equal(s,shop);assert.deepEqual(ids,['1']);assert.equal(task,99);record('search');},
  invalidate:async(s,options)=>{assert.equal(s,shop);assert.equal(options.kind,'products');assert.deepEqual(options.collectionIds,['gid://shopify/Collection/7']);record('invalidate');},
  publish:async()=>record('publish'),
 };
 return {job,deps,events,patches,read:()=>saved,run:()=>refreshProductMarketPrices(job,deps)};
}
test('verified country prices persist for all variants, update sort/search data, invalidate, then publish SSE',async()=>{
 const f=fixture();const result=await f.run();assert.equal(result.changed,true);
 assert.deepEqual(f.events,['checkpoint','save','index','search','invalidate','publish']);
 assert.deepEqual(f.read().variants.map(v=>v.marketPrices.IN.price),[1100,2200]);
 assert.deepEqual(f.read().variants.map(v=>v.marketPrices.GB.price),[10,20]);
 assert.deepEqual(f.read().variants.map(v=>v.price),[10,20]);
 assert.deepEqual(f.patches[0].fields,{marketPriceMin_IN:1100,marketPriceMax_IN:2200,marketPriceCurrency_IN:'INR',marketAvailablePriceMin_IN:1100,marketAvailablePriceMax_IN:2200});
});
test('unchanged amounts ignore JSON key order and do not write or rerank or emit an event',async()=>{
 const f=fixture({unchanged:true});assert.equal((await f.run()).changed,false);assert.deepEqual(f.events,[]);
});
for(const failPhase of ['index','search','invalidate','publish']){
 test('a retry repairs completion after '+failPhase+' fails following the database commit',async()=>{
  const f=fixture({failPhase});await assert.rejects(f.run(),new RegExp(failPhase+' failed'));
  assert.equal(f.read().variants[0].marketPrices.IN.price,1100);
  assert.equal(f.job.data.priceRefreshChanged,true);
  await f.run();
  assert.equal(f.events.filter(e=>e==='save').length,1);
  assert.equal(f.events.at(-1),'publish');
 });
}
for(const options of [{currency:'USD'},{missing:true}]){
 test('invalid currency or incomplete variant pages cannot partly save or announce a price change '+JSON.stringify(options),async()=>{
  const f=fixture(options);await assert.rejects(f.run());assert.deepEqual(f.events,[]);
  assert.equal(f.read().variants[0].marketPrices.IN.price,1000);
 });
}
test('a concurrent product change or lost lease prevents announcing an uncommitted refresh',async()=>{
 const f=fixture();f.deps.save=async()=>{throw Error('Product changed');};await assert.rejects(f.run(),/Product changed/);assert.equal(f.events.includes('publish'),false);
 const g=fixture();g.deps.assertOwned=async()=>{throw Error('lease lost');};await assert.rejects(g.run(),/lease lost/);assert.equal(g.events.includes('save'),false);
});

async function queueFixture({state,finishedOn=0,priceRefreshChanged=false}={}){
 const added=[],removed=[],lookups=[];
 const existing=state?{data:{priceRefreshChanged},getState:async()=>state,finishedOn,remove:async()=>removed.push(true)}:null;
 const mocks={
  '../db.server.js':{default:{product:{findMany:async query=>{lookups.push(query);return [{id:'gid://shopify/Product/1'}];}}}},
  './meiliClient.server.js':{default:{}},
  './productSyncQueue.server.js':{productSyncQueue:{getJob:async()=>existing,add:async(...args)=>added.push(args)}},
  './marketPriceInstallation.server.js':{discoverPriceCountries:async()=>({currencies:{IN:'INR'}})},
  './shopCache.server.js':{getCached:async(_key,read)=>read(),invalidateShop:async()=>{}},
  './productPriceLock.server.js':{withProductPriceLock:async()=>{}},
  '../utils/refreshProductMarketPrices.js':{refreshProductMarketPrices},
  '../utils/saveProductMarketPrices.js':{saveProductMarketPrices},
  './priceEvents.server.js':{publishProductPriceChange:async()=>{}},
  './searchIndex.server.js':{refreshSearchIndexProductPrices:async()=>{}},
 };
 const service=await loadModule('app/services/marketPriceRefresh.server.js',mocks);
 const scope={shop:'fixture.myshopify.com',country:'IN',currency:'INR',ids:['1','999']};
 return {scope,added,removed,lookups,request:(value=scope)=>service.requestMarketPriceRefresh(value)};
}
test('refresh requests include only existing tenant products and share in-flight jobs, with no completed-check TTL on reload',async()=>{
 for(const state of [undefined,'active','completed','failed']){
  const f=await queueFixture({state,priceRefreshChanged:state==='failed'});
  await f.request();
  assert.equal(f.lookups[0].where.shop,f.scope.shop);
  assert.equal(f.added.length,state==='active'?0:1);
  if(f.added.length){assert.equal(f.added[0][0],'REFRESH_MARKET_PRICES');assert.equal(f.added[0][1].productId,'gid://shopify/Product/1');assert.equal(f.added[0][1].priceRefreshChanged,state==='failed');}
 }
});
test('unsupported country/currency, invalid IDs and recent exhausted failures do not enqueue more work',async()=>{
 const f=await queueFixture();assert.equal((await f.request({...f.scope,currency:'USD'})).unsupported,true);assert.equal(f.lookups.length,0);
 await assert.rejects(f.request({...f.scope,ids:['<script>']}));assert.equal(f.added.length,0);
 const failed=await queueFixture({state:'failed',finishedOn:Date.now()});await failed.request();assert.equal(failed.added.length,0);
});

