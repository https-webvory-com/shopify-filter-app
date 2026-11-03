import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/search-ranking.mjs';

test('price intent opens only after complete DB/index coverage and closes on catalog revision', async () => {
  const shop = 'fixture.myshopify.com', values = new Map(), searches = [], observed = new Map();
  let priced = 2;
  const redis = { get: async key => values.get(key) || null,
    sadd: async (key, value) => { if (!observed.has(key)) observed.set(key, new Set()); observed.get(key).add(value); },
    smembers: async key => [...(observed.get(key) || [])],
    setex: async (key, _seconds, value) => { values.set(key, value); },
    del: async key => { values.delete(key); } };
  const database = {
    $queryRaw: async () => [{ products: 2, variants: 4, priced: 4 }],
    marketStorefrontConnection: { findMany: async () => [{ shop, countries: ['US'] }] },
  };
  const index = { getFilterableAttributes: async () => ['marketPriceMin_US','marketAvailablePriceMin_US'],
    search: async (_q, options) => {
      searches.push(options);
      return { totalHits: options.filter.some(value => value.includes('EXISTS')) ? priced : 2 };
    } };
  const service = await loadModule('app/services/marketPriceCoverage.server.js', {
    '../db.server.js': { default: database }, './redis.server.js': { default: redis },
    './meiliClient.server.js': { default: { index: () => index } },
    './searchIndex.server.js': { getSearchIndexContext: async () => ({ uid: 'products' }) },
    '../utils/shopCacheInvalidation.js': { productRevisionKey: () => 'product-revision' },
  });
  assert.equal(await service.marketPriceIntentReady(shop, 'US'), false);
  assert.deepEqual(Array.from(await service.marketPriceCountriesForShop(shop)), ['US']);
  assert.ok(observed.get('marketPriceObservedShops').has(shop));
  assert.equal((await service.refreshMarketPriceCoverage(shop, 'US')).complete, true);
  assert.equal(await service.marketPriceIntentReady(shop, 'US'), true);
  assert.ok(searches.every(call => call.hitsPerPage === 1 && call.page === 1));
  values.set('product-revision', '2');
  assert.equal(await service.marketPriceIntentReady(shop, 'US'), false);
  priced = 1;
  assert.equal((await service.refreshMarketPriceCoverage(shop, 'US')).complete, false);
  assert.equal(await service.marketPriceIntentReady(shop, 'US'), false);
});

test('an observed country queues one scoped bulk price pass and retries after a conflicting sync', async () => {
  const shop='fixture.myshopify.com', sets=new Map(), claims=new Set(), calls=[];
  const redis={get:async()=>null,sadd:async(key,value)=>{
    if(!sets.has(key))sets.set(key,new Set());sets.get(key).add(value);
  },smembers:async key=>[...(sets.get(key)||[])],
  set:async key=>claims.has(key)?null:(claims.add(key),'OK'),del:async key=>claims.delete(key)};
  const db={$queryRaw:async()=>[{products:2,variants:4,priced:0}],
    marketStorefrontConnection:{findMany:async()=>[],findUnique:async()=>null}};
  const service=await loadModule('app/services/marketPriceCoverage.server.js',{
    '../db.server.js':{default:db},'./redis.server.js':{default:redis},
    './meiliClient.server.js':{default:{index:()=>({})}},
    '../utils/shopCacheInvalidation.js':{productRevisionKey:()=> 'revision'},
  });
  await service.marketPriceIntentReady(shop,'IN');
  const startSync=async(...args)=>{calls.push(args);return{message:'Bulk product index started in background'};};
  await service.refreshConnectedMarketPriceCoverage({startSync});
  await service.refreshConnectedMarketPriceCoverage({startSync});
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],shop);assert.equal(calls[0][1].restart,true);
  claims.clear();
  await service.refreshConnectedMarketPriceCoverage({startSync:async()=>({message:'Product sync is already running'})});
  assert.equal(claims.size,0,'a running old sync must not block the new country for six hours');
});
