import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {transform} from 'esbuild';import * as crypto from 'node:crypto';
const url='https://fixture/api/market-prices?shop=fixture.myshopify.com&country=IN&currency=INR&ids=1,2';
async function route({limited=false,unavailable=false}={}){
 const queued=[],reads=[];
 const source=(await fs.readFile('app/routes/api.market-prices.jsx','utf8')).replace("await import('../services/marketPriceRefresh.server.js')","({requestMarketPriceRefresh:enqueue})");
 const enqueue=async data=>{if(unavailable)throw Error('offline');queued.push(data);return {accepted:data.ids.length};};
 const ctx={module:{exports:{}},exports:{},URL,Response,enqueue,require:name=>({
  '../db.server':{__esModule:true,default:{product:{findMany:async args=>{reads.push(args);return [];}}}},
  '../services/rateLimiter.server':{rateLimit:async()=>!limited},
  '../utils/savedMarketPricing.js':{savedMarketProduct:v=>v},
  '../services/marketPriceRefresh.server.js':{requestMarketPriceRefresh:async data=>{if(unavailable)throw Error('offline');queued.push(data);return {accepted:data.ids.length};}},
 }[name])};
 vm.runInNewContext((await transform(source,{format:'cjs',loader:'jsx'})).code,ctx);
 return {queued,reads,...ctx.module.exports};
}
test('POST requests durable verification with IDs and context only; saved-price GET remains read-only',async()=>{
 const f=await route();
 const response=await f.action({request:new Request(url,{method:'POST',body:JSON.stringify({price:1,marketPrices:{IN:{price:1}}})})});
 assert.equal(response.status,202);assert.equal(response.headers.get('access-control-allow-origin'),'*');
 assert.deepEqual(JSON.parse(JSON.stringify(f.queued[0])),{shop:'fixture.myshopify.com',country:'IN',currency:'INR',ids:['1','2']});
 const saved=await f.loader({request:new Request(url)});assert.equal(saved.status,200);assert.equal(f.reads.length,1);assert.equal(f.queued.length,1);
});
test('invalid, unbounded, rate-limited and unavailable refreshes cannot claim success',async()=>{
 for(const bad of [url.replace('ids=1,2','ids=oops'),url.replace('country=IN','country=in'),url.replace('fixture.myshopify.com','evil.com'),url.replace('ids=1,2','ids='+Array.from({length:41},(_,i)=>i+1).join(','))]){
  const f=await route();assert.equal((await f.action({request:new Request(bad,{method:'POST'})})).status,400);assert.equal(f.queued.length,0);
 }
 const f=await route({limited:true});assert.equal((await f.action({request:new Request(url,{method:'POST'})})).status,429);assert.equal(f.queued.length,0);
 const g=await route({unavailable:true});assert.equal((await g.action({request:new Request(url,{method:'POST'})})).status,503);
});
test('product price workers are dispatched without creating a catalog sync job',async()=>{
 let runs=0;
 const source=(await fs.readFile('app/workers/productSyncWorker.server.js','utf8')).replace("await import('../services/marketPriceRefresh.server.js')","({processMarketPriceRefresh:processRefresh})");
 const ctx={module:{exports:{}},exports:{},processRefresh:async job=>{runs++;assert.equal(job.data.country,'IN');return {changed:true};},require:name=>name.includes('db.server')?{default:{syncJob:{findUnique:()=>{throw Error('Must not touch full-sync state');}}}}:{}};
 vm.runInNewContext((await transform(source,{format:'cjs'})).code,ctx);
 assert.equal((await ctx.module.exports.processProductSyncJob({name:'REFRESH_MARKET_PRICES',data:{country:'IN'}})).changed,true);assert.equal(runs,1);
});
test('product locks serialize price and webhook writes, and lost leases fail closed',async()=>{
 const values=new Map();let timer,cleared=0;
 const redis={set:async(k,v)=>{if(values.has(k))return null;values.set(k,v);return 'OK';},get:async k=>values.get(k),eval:async(script,_n,key,owner)=>{
  if(values.get(key)!==owner)return 0;
  if(script.includes("'DEL'"))values.delete(key);return 1;
 }};
 const ctx={module:{exports:{}},exports:{},setInterval:fn=>{timer=fn;return {unref(){}};},clearInterval:()=>cleared++,require:name=>name==='node:crypto'?crypto:{__esModule:true,default:redis}};
 vm.runInNewContext((await transform(await fs.readFile('app/services/productPriceLock.server.js','utf8'),{format:'cjs'})).code,ctx);
 const run=ctx.module.exports.withProductPriceLock;
 await run('fixture.myshopify.com','1',async assertOwned=>{
  await assert.rejects(run('fixture.myshopify.com','gid://shopify/Product/1',async()=>assert.fail()),/busy/);
  await assertOwned();values.set([...values.keys()][0],'new-owner');timer();await new Promise(r=>setImmediate(r));
  await assert.rejects(assertOwned(),/lease lost/);
 });
 assert.equal([...values.values()][0],'new-owner','Old owner must never delete a newer lease');assert.equal(cleared,1);
});

