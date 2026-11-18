import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';

test('saved country fields stay usable without Redis proof, revisions or catalog scans',async()=>{
 let settings={filterableAttributes:['marketAvailablePriceMin_IN','marketPriceMin_IN'],sortableAttributes:['marketAvailablePriceMin_IN','marketPriceMin_IN']};
 const fail=()=>{throw Error('Whole-store proof must not be read');};
 const service=await loadModule('app/services/marketPriceCoverage.server.js',{
  '../db.server.js':{default:{$queryRaw:fail}},'./redis.server.js':{default:{get:fail,setex:fail}},
  './shopCache.server.js':{getCached:async(_key,read)=>read()},
  './meiliClient.server.js':{default:{index:()=>({getSettings:async()=>settings,search:fail})}},
 });
 assert.equal(await service.marketPriceIntentReady('owner.myshopify.com','IN'),true);
 assert.equal(await service.marketPriceIntentReady('owner.myshopify.com','IN',{stockOnly:false}),true);
 settings={filterableAttributes:[],sortableAttributes:[]};
 assert.equal(await service.marketPriceIntentReady('owner.myshopify.com','GB'),false);
 assert.equal(await service.marketPriceIntentReady('bad-shop','IN'),false);
});

test('installation countries supersede shopper observations and join shared field configuration',async()=>{
 const service=await loadModule('app/services/marketPriceCoverage.server.js',{
  '../db.server.js':{default:{marketPriceConfiguration:{findUnique:async()=>({countries:['IN','GB']}),findMany:async()=>[{countries:['IN','GB']}]},marketStorefrontConnection:{findUnique:async()=>null,findMany:async()=>[]}}},
  './redis.server.js':{default:{smembers:async()=>['US']}},'./shopCache.server.js':{getCached:async(_key,read)=>read()},'./meiliClient.server.js':{default:{}},
 });
 assert.deepEqual(Array.from(await service.marketPriceCountriesForShop('owner.myshopify.com')),['GB','IN']);
 assert.deepEqual(Array.from(await service.allMarketPriceCountries()),['GB','IN','US']);
});
