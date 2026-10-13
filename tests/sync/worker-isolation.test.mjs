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
test("local development retains its combined worker mode",async()=>{
  const calls=await redisRole(undefined);assert.ok(calls.some(([name])=>name==="sync"));assert.ok(calls.some(([name])=>name==="keys"));
});

async function runner({failReady=false,missingWorkers=false}={}) {
  const files=new Map(),calls=[],signals={};
  const worker=name=>({waitUntilReady:async()=>{calls.push("ready:"+name);if(failReady)throw Error("Redis unavailable");},close:async()=>calls.push("close:"+name)});
  const ctx={global:{},console:{log(){},error(){}},process:{env:{CFP_WORKER_MODE:"web"},pid:42,
    once:(signal,callback)=>{signals[signal]=callback;},exit:code=>calls.push("exit:"+code)},
    fs:{rmSync:path=>files.delete(path),writeFileSync:(path,value)=>files.set(path,value)},delay:async()=>{},
    loadBundle:async()=>{assert.equal(ctx.process.env.CFP_WORKER_MODE,"worker");if(!missingWorkers){ctx.global.__productSyncWorker=worker("sync");ctx.global.__webhookWorker=worker("webhooks");ctx.global.__collectionRankingWorker=worker("ranking");}},
  };
  const source=(await fs.readFile("scripts/run-background-worker.mjs","utf8"))
    .replace(/^import .*;\r?\n/gm,"")
    .replace('await import("../build/server/index.js")','await loadBundle()');
  await vm.runInNewContext("(async()=>{\n"+source+"\n})()",ctx);
  return {files,calls,signals};
}
test("worker readiness is published only after all Redis workers are ready",async()=>{
  const f=await runner();assert.deepEqual(f.calls,["ready:sync","ready:webhooks","ready:ranking"]);
  assert.equal(f.files.get("/tmp/cfp-background-worker.ready"),"42");
});
test("a failed worker startup reports failure and never publishes readiness",async()=>{
  for(const options of [{failReady:true},{missingWorkers:true}]){
    const f=await runner(options);assert.equal(f.files.size,0);assert.ok(f.calls.includes("exit:1"));
  }
});
test("worker shutdown closes processors and removes readiness without touching web processes",async()=>{
  const f=await runner();await f.signals.SIGTERM();assert.equal(f.files.size,0);
  assert.ok(f.calls.includes("close:sync"));assert.ok(f.calls.includes("close:webhooks"));assert.equal(f.calls.at(-1),"exit:0");
  assert.ok(f.calls.includes('close:ranking'));
});
