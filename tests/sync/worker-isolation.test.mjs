import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import { transform } from "esbuild";

async function redisRole(mode) {
  const calls=[];
  class Redis extends EventEmitter {async keys(pattern){calls.push(["keys",pattern]);return [];} }
  const mocks={ioredis:{__esModule:true,default:Redis},
    './redisConnection.server.js':{REDIS_URL:'redis://fixture:6379'},
    "../workers/webhookWorker.server.js":{initWebhookWorker:()=>calls.push(["webhooks"])},
    "../workers/productSyncWorker.server.js":{initProductSyncWorker:()=>calls.push(["sync"])},
  };
  const ctx={module:{exports:{}},exports:{},global:{},process:{env:{CFP_WORKER_MODE:mode}},console:{log(){},error(){}},require:name=>mocks[name]};
  vm.runInNewContext((await transform(await fs.readFile("app/services/redis.server.js","utf8"),{format:"cjs"})).code,ctx);
  ctx.module.exports.default.emit("connect");
  await Promise.resolve();
  return calls;
}

test("web server Redis connection never starts background job processors",async()=>{
  const calls=await redisRole("web");assert.ok(!calls.some(([name])=>name==="sync"||name==="webhooks"));
  assert.equal(calls.filter(([name])=>name==="keys").length,3);
});
test("dedicated worker starts both processors without clearing storefront caches",async()=>{
  assert.deepEqual(await redisRole("worker"),[["webhooks"],["sync"]]);
});
test("standalone sales jobs start no workers and do not clear storefront caches",async()=>{
  assert.deepEqual(await redisRole("standalone"),[]);
});
test("local development retains its combined worker mode",async()=>{
  const calls=await redisRole(undefined);assert.ok(calls.some(([name])=>name==="sync"));assert.ok(calls.some(([name])=>name==="keys"));
});

async function runner({failReady=false,missingWorkers=false,missingCountryWorker=false,missingScheduler=false,warmup=async()=>{},catalogAudit=async()=>{},marketCheck=async()=>{}}={}) {
  const files=new Map(),calls=[],signals={},timers=[];
  const worker=name=>({waitUntilReady:async()=>{calls.push("ready:"+name);if(failReady)throw Error("Redis unavailable");},close:async()=>calls.push("close:"+name)});
  const ctx={global:{},console:{log(){},error(){}},process:{env:{CFP_WORKER_MODE:"web"},pid:42,
    once:(signal,callback)=>{signals[signal]=callback;},exit:code=>calls.push("exit:"+code)},
    fs:{rmSync:path=>files.delete(path),writeFileSync:(path,value)=>files.set(path,value)},delay:async()=>{},
    setInterval:(callback,ms)=>{const timer={callback,ms,stopped:false,unref(){}};timers.push(timer);return timer;},clearInterval:timer=>{timer.stopped=true;},
    loadBundle:async()=>{assert.equal(ctx.process.env.CFP_WORKER_MODE,"worker");if(!missingWorkers){ctx.global.__productSyncWorker=worker("sync");ctx.global.__webhookWorker=worker("webhooks");ctx.global.__collectionRankingWorker=worker("ranking");ctx.global.__searchIndexWorker=worker("search-index");ctx.global.__collectionOrderWorker=worker("order");ctx.global.__collectionMembershipWorker=worker("membership");if(!missingCountryWorker)ctx.global.__marketAvailabilityWorker=worker('country-stock');ctx.global.__schedulePublicCollectionWarmups=warmup;ctx.global.__reconcileLegacySynonymIndexes=async()=>{};if(!missingScheduler){ctx.global.__scheduleCatalogDriftAudits=catalogAudit;ctx.global.__refreshConnectedMarketPriceCoverage=marketCheck;}}},
  };
  const source=(await fs.readFile("scripts/run-background-worker.mjs","utf8"))
    .replace(/^import .*;\r?\n/gm,"")
    .replace('await import("../build/server/index.js")','await loadBundle()')
    .replace("await import('../app/services/sizeMapping.server.js')",'({scheduleUnclassifiedSizeMappingRebuilds:async()=>{}})');
  await vm.runInNewContext("(async()=>{\n"+source+"\n})()",ctx);
  return {files,calls,signals,timers};
}
test("worker readiness is published only after all Redis workers are ready",async()=>{
  const f=await runner();assert.deepEqual(f.calls,["ready:sync","ready:webhooks","ready:ranking","ready:search-index","ready:order","ready:membership","ready:country-stock"]);
  assert.equal(f.files.get("/tmp/cfp-background-worker.ready"),"42");
});
test("a failed worker startup reports failure and never publishes readiness",async()=>{
  for(const options of [{failReady:true},{missingWorkers:true},{missingCountryWorker:true},{missingScheduler:true}]){
    const f=await runner(options);assert.equal(f.files.size,0);assert.ok(f.calls.includes("exit:1"));
  }
});
test('market price and catalog checks use bundled worker callbacks on startup and timer',async()=>{
 let catalog=0,market=0;
 const f=await runner({catalogAudit:async()=>{catalog++;},marketCheck:async()=>{market++;}});
 assert.equal(catalog,1);assert.equal(market,1);
 assert.equal(f.timers[2].ms,3600000);assert.equal(f.timers[3].ms,120000);
 await new Promise(resolve=>setImmediate(resolve));
 await f.timers[2].callback();await f.timers[3].callback();
 assert.equal(catalog,2);assert.equal(market,2);
});
test("worker shutdown closes processors and removes readiness without touching web processes",async()=>{
  const f=await runner();await f.signals.SIGTERM();assert.equal(f.files.size,0);
  assert.ok(f.calls.includes("close:sync"));assert.ok(f.calls.includes("close:webhooks"));assert.equal(f.calls.at(-1),"exit:0");
  assert.ok(f.calls.includes('close:ranking'));assert.ok(f.calls.includes('close:order'));
  assert.ok(f.calls.includes('close:country-stock'));
  assert.equal(f.timers[0].stopped,true);
});

test('worker warms on startup and periodically without overlapping slow ticks or running after shutdown',async()=>{
  let count=0,finish;const f=await runner({warmup:async()=>{count++;await new Promise(resolve=>finish=resolve);}});
  assert.equal(count,1);assert.equal(f.timers[0].ms,60000);await f.timers[0].callback();assert.equal(count,1);
  finish();await new Promise(resolve=>setImmediate(resolve));
  const next=f.timers[0].callback();assert.equal(count,2);finish();await next;
  await f.signals.SIGTERM();await f.timers[0].callback();assert.equal(count,2);
});

test('warmup scheduler failures do not make healthy workers unready',async()=>{
  const f=await runner({warmup:async()=>{throw Error('Registry unavailable');}});
  assert.equal(f.files.size,1);assert.ok(!f.calls.includes('exit:1'));
  await f.timers[0].callback();assert.equal(f.files.size,1);
});
