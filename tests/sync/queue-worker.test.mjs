import { syncErrorMessage } from "../../app/utils/syncError.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";

async function worker({status="IN_PROGRESS",attempt=0,error}={}) {
  const calls=[];const saved={completedAt:status==="COMPLETED"?new Date():null,shop:"fixture.myshopify.com",status,cursor:"saved-page-138",productsProcessed:6900};
  const prisma={syncJob:{findUnique:async()=>saved, update:async({data})=>{calls.push(data.status);Object.assign(saved,data);}}};
  const source=(await fs.readFile("app/workers/productSyncWorker.server.js","utf8"))
    .replace('await import("../shopify.server.js")','({unauthenticated: auth})')
    .replace('await import("../services/sync.server.js")','({runProductSync: sync})');
  const ctx={module:{exports:{}},exports:{},require:name=>name.includes("db.server")?{__esModule:true,default:prisma}:name.includes("syncError")?{syncErrorMessage}:{},
    auth:{admin:async()=>({admin:{}})},sync:async(id,shop,admin,options)=>{assert.equal(options.markFailure,false);assert.equal(id,"existing-job");assert.equal(shop,saved.shop);assert.equal(saved.cursor,"saved-page-138");if(error)throw error;await prisma.syncJob.update({data:{status:"COMPLETED"}});}};
  vm.runInNewContext((await transform(source,{format:"cjs"})).code,ctx);
  return {calls,saved,run:()=>ctx.module.exports.processProductSyncJob({data:{shop:saved.shop,syncJobId:"existing-job"},attemptsMade:attempt,opts:{attempts:10}})};
}

test("a restarted worker resumes the saved job rather than creating a fresh sync",async()=>{
  const f=await worker();await f.run();assert.deepEqual(f.calls,["IN_PROGRESS","COMPLETED"]);
});
test("temporary failure stays in progress for automatic queue retry",async()=>{
  const f=await worker({error:Error("Shopify unavailable")});await assert.rejects(f.run(),/Shopify unavailable/);assert.equal(f.calls.at(-1),"IN_PROGRESS");assert.equal(f.saved.retryCount,1);assert.match(f.saved.lastError,/could not be reached/);
});
test("exhausted retries report failure instead of claiming completion",async()=>{
  const f=await worker({attempt:9,error:Error("disk full")});await assert.rejects(f.run(),/disk full/);assert.equal(f.calls.at(-1),"FAILED");assert.equal(f.saved.retryCount,10);assert.match(f.saved.lastError,/disk space/);
});
test("redelivery of an already completed sync does no additional work",async()=>{
  const f=await worker({status:"COMPLETED"});await f.run();assert.deepEqual(f.calls,[]);
});

test("enqueueing the same running sync reuses its persistent queue job",async()=>{
  let adds=0;const existing={getState:async()=>"active"};
  class Queue {on(){} async getJob(){return existing;} async add(){adds++;}}
  const ctx={module:{exports:{}},exports:{},global:{},console,require:name=>name==="bullmq"?{Queue}:{redisOptions:{}}};
  vm.runInNewContext((await transform(await fs.readFile("app/services/productSyncQueue.server.js","utf8"),{format:"cjs"})).code,ctx);
  assert.equal(await ctx.module.exports.enqueueProductSync("same-job","fixture.myshopify.com"),existing);assert.equal(adds,0);
});
