import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import {readProductMarketPrices} from '../../app/utils/readProductMarketPrices.js';

async function fixture({existing=false,previous=false}={}){
 const writes=[],starts=[];
 const service=await loadModule('app/services/marketPriceInstallation.server.js',{
  '../db.server.js':{default:{marketPriceConfiguration:{upsert:async value=>writes.push(value)},product:{findFirst:async()=>existing?{id:'1'}:null},syncJob:{findFirst:async()=>previous?{id:'old'}:null}}},
  './productSyncQueue.server.js':{productSyncQueue:{}},
 });
 const supported={countries:['GB','IN'],currencies:{GB:'GBP',IN:'INR'}};
 return {service,writes,starts,options:{discover:async()=>supported,startInitial:async shop=>{starts.push(shop);return {jobId:'initial'};}}};
}

test('installation discovers all enabled countries without waiting for shopper traffic',async()=>{
 const {service}=await fixture();
 const supported=await service.discoverPriceCountries('owner.myshopify.com',async(url,options)=>{
  assert.equal(url,'https://owner.myshopify.com/api/2025-10/graphql.json');
  assert.match(JSON.parse(options.body).query,/availableCountries/);
  return {ok:true,json:async()=>({data:{localization:{availableCountries:[{isoCode:'IN',currency:{isoCode:'INR'}},{isoCode:'GB',currency:{isoCode:'GBP'}}]}}})};
 });
 assert.deepEqual(Array.from(supported.countries),['GB','IN']);
});

test('initial country preparation is queued only for a new empty installation',async()=>{
 for(const settings of [{},{existing:true},{previous:true}]){
  const f=await fixture(settings);await f.service.prepareInstallationPrices('owner.myshopify.com',f.options);
  assert.equal(f.writes.length,1);assert.equal(f.starts.length,settings.existing||settings.previous?0:1);
  assert.deepEqual(Array.from(f.writes[0].create.countries),['GB','IN']);
 }
});

test('changed-product price reads are bounded by country and variant page and touch only that product',async()=>{
 const product={id:'gid://shopify/Product/1',variants:{nodes:[{id:'v1'},{id:'v2'}]}};
 const calls=[];const countries=['US','IN','GB','CA','DE'];
 const admin={graphql:async(query,{variables})=>{
  calls.push(variables);assert.equal(variables.id,product.id);assert.match(query,/variants\(first:50/);
  const selected=[...query.matchAll(/cfpMarket_([A-Z]{2}):/g)].map(m=>m[1]);assert.ok(selected.length<=4);
  const id=variables.cursor?'v2':'v1';
  return {json:async()=>({data:{product:{id:product.id,variants:{nodes:[{id,...Object.fromEntries(selected.map(c=>['cfpMarket_'+c,{price:{amount:'10',currencyCode:'USD'}}]))}],pageInfo:{hasNextPage:!variables.cursor,endCursor:'next'}}}}})};
 }};
 await readProductMarketPrices(product,admin,countries);
 assert.equal(calls.length,4);assert.ok(product.variants.nodes.every(v=>countries.every(c=>v['cfpMarket_'+c])));
 await readProductMarketPrices(product,admin,countries);assert.equal(calls.length,4,'complete bulk records need no further reads');
});

test('a failed country batch cannot partly overwrite saved product prices',async()=>{
 const product={id:'gid://shopify/Product/1',variants:{nodes:[{id:'v1'}]}};let calls=0;
 const admin={graphql:async(query)=>{if(++calls===2)throw Error('offline');return {json:async()=>({data:{product:{id:product.id,variants:{nodes:[{id:'v1',...Object.fromEntries([...query.matchAll(/cfpMarket_([A-Z]{2}):/g)].map(m=>['cfpMarket_'+m[1],null]))}],pageInfo:{hasNextPage:false}}}}})};}};
 await assert.rejects(()=>readProductMarketPrices(product,admin,['US','IN','GB','CA','DE']),/offline/);
 assert.deepEqual(product.variants.nodes,[{id:'v1'}]);
});
