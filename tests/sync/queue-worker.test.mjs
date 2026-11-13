import { syncErrorMessage } from "../../app/utils/syncError.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";

class DelayedError extends Error {}

async function worker({status="IN_PROGRESS",attempt=0,error, continuation=false,scanRestarts=0}={}) {
  const calls=[];const saved={completedAt:status==="COMPLETED"?new Date():null,shop:"fixture.myshopify.com",status,cursor:"saved-page-138",productsProcessed:6900};
  const prisma={syncJob:{findUnique:async()=>saved, update:async({data})=>{calls.push(data.status);Object.assign(saved,data);},updateMany:async({where,data})=>{assert.equal(where.shop,saved.shop);if(saved.status===where.status){calls.push(data.status);Object.assign(saved,data);}return {count:1};}}};
  const source=(await fs.readFile("app/workers/productSyncWorker.server.js","utf8"))
    .replace('await import("../shopify.server.js")','({unauthenticated: auth})')
    .replace('await import("../services/sync.server.js")','({runProductSync: sync})');
  const ctx={module:{exports:{}},exports:{},require:name=>name==="bullmq"?{DelayedError}:name.includes("db.server")?{__esModule:true,default:prisma}:name.includes("syncError")?{syncErrorMessage}:{},
    auth:{admin:async()=>({admin:{}})},sync:async(id,shop,admin,options)=>{assert.equal(options.markFailure,false);assert.equal(id,"existing-job");assert.equal(shop,saved.shop);assert.equal(saved.cursor,"saved-page-138");if(error)throw error;if(continuation)return {needsContinuation:true};await prisma.syncJob.update({data:{status:"COMPLETED"}});}};
  vm.runInNewContext((await transform(source,{format:"cjs"})).code,ctx);
  const delays=[];
  const job={data:{shop:saved.shop,syncJobId:"existing-job",scanRestarts},attemptsMade:attempt,opts:{attempts:10},updateData:async data=>{job.data=data;},moveToDelayed:async(time,token)=>delays.push({time,token})};
  return {calls,saved,delays,job,run:()=>ctx.module.exports.processProductSyncJob(job,"lock-token"),failed:state=>ctx.module.exports.recordProductSyncQueueFailure({...job,getState:async()=>state},Error('job stalled more than allowable limit'))};
}

test("a restarted worker resumes the saved job rather than creating a fresh sync",async()=>{
  const f=await worker();await f.run();assert.deepEqual(f.calls,["IN_PROGRESS","COMPLETED"]);
});
test("temporary failure stays in progress for automatic queue retry",async()=>{
  const f=await worker({error:Error("Shopify unavailable")});await assert.rejects(f.run(),/Shopify unavailable/);assert.equal(f.calls.at(-1),"IN_PROGRESS");assert.equal(f.saved.retryCount,1);assert.match(f.saved.lastError,/could not be reached/);
});

test('an exhausted pagination checkpoint restarts a bounded fresh scan without clearing catalog data',async()=>{
 const error=Object.assign(Error('Shopify pagination stopped with unread products'),{restartProductScan:true,expectedTotal:9000});
 const f=await worker({error});await assert.rejects(f.run(),/unread products/);
 assert.equal(f.saved.status,'IN_PROGRESS');assert.equal(f.saved.cursor,null);assert.equal(f.saved.productsProcessed,0);assert.equal(f.saved.totalProducts,9000);assert.equal(f.job.data.scanRestarts,1);assert.equal(f.job.data.syncJobId,'existing-job');
 const bounded=await worker({error,scanRestarts:2});await assert.rejects(bounded.run());assert.equal(bounded.saved.cursor,'saved-page-138');assert.equal(bounded.job.data.scanRestarts,2);
 const exhausted=await worker({error,attempt:9});await assert.rejects(exhausted.run());assert.equal(exhausted.saved.status,'FAILED');assert.equal(exhausted.saved.cursor,'saved-page-138');
});

test('terminal stalled jobs update the matching dashboard record without overwriting completion or retry status',async()=>{
 const failed=await worker();await failed.failed('failed');assert.equal(failed.saved.status,'FAILED');assert.match(failed.saved.lastError,/worker was interrupted/);assert.equal(failed.saved.cursor,'saved-page-138');
 const retry=await worker();await retry.failed('delayed');assert.equal(retry.saved.status,'IN_PROGRESS');
 const completed=await worker({status:'COMPLETED'});await completed.failed('failed');assert.equal(completed.saved.status,'COMPLETED');
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

test("a committed batch releases the worker for other stores without consuming a failure retry",async()=>{
  const f=await worker({continuation:true});
  await assert.rejects(f.run(),DelayedError);
  assert.deepEqual(f.calls,["IN_PROGRESS"]);
  assert.equal(f.saved.retryCount,undefined);
  assert.equal(f.saved.cursor,"saved-page-138");
  assert.equal(f.delays.length,1);
  assert.equal(f.delays[0].token,"lock-token");
});
