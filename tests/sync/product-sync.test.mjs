import { syncErrorMessage } from "../../app/utils/syncError.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import { isStorefrontProduct } from "../../app/utils/storefrontProduct.js";

async function fixture({ failSetup = false, failIndex = false, finalizationGate } = {}) {
  const updates = [];
  let heartbeat, cleared = false;
  const job = { id: "job", status: "IN_PROGRESS", cursor: "last-saved", productsProcessed: 6900 };
  const prisma = {
    syncJob: {
      findUnique: async () => job,
      update: async ({data}) => { updates.push(data); return job; },
      updateMany: async ({data}) => { updates.push(data); return {count:1}; },
    },
    filterSetting: {findMany: async () => {if(failSetup) throw Error("database unavailable"); return []; }},
    product: {deleteMany: async () => {}},
    $queryRaw: async () => [],
  };
  const index = new Proxy({
    deleteDocument: async () => {},
    addDocuments: async () => { if(failIndex) throw Error("index unavailable"); return {taskUid:1}; },
  }, {get: (target,key) => target[key] || (async () => ({}))});
  const mocks = {
    "../utils/syncError.js": { syncErrorMessage },
    "../db.server": {__esModule:true,default:prisma},
    "./meiliClient.server": {__esModule:true,default:{index:()=>index,tasks:{waitForTask:async()=>({status:"succeeded"})}}},
    "./shopCache.server": {invalidateShop: async () => {}},
    "../utils/storefrontProduct.js": {isStorefrontProduct},
    "../utils/semanticSearch.js": {},
  };
  const source = (await fs.readFile("app/services/sync.server.js","utf8"))
    .replace('await import("./orders.server.js")','({syncHistoricalOrders: finishOrders})');
  const context = {module:{exports:{}}, exports:{}, require:name=>mocks[name],
    process:{env:{}}, console:{log(){},error(){},warn(){}},
    setTimeout: callback=>callback(), setInterval: callback=>{heartbeat=callback;return {unref(){}};},
    clearInterval:()=>{cleared=true;}, finishOrders:async()=>{if(finalizationGate) await finalizationGate;},
  };
  vm.runInNewContext((await transform(source,{format:"cjs"})).code,context);
  const admin = {graphql:async (query,{variables}={})=>({json:async()=>{
    if(query.includes("getPublishedCollections")) return {data:{collections:{nodes:[],pageInfo:{hasNextPage:false}}}};
    assert.equal(variables.cursor,"last-saved");
    assert.ok(query.includes("products(first: 10"));
    return {data:{products:{nodes:failIndex?[{id:"gid://shopify/Product/1",status:"DRAFT"}]:[],pageInfo:{hasNextPage:false,endCursor:"end"}}}};
  }})};
  return {run:options=>context.module.exports.runProductSync("job","fixture.myshopify.com",admin,options),updates,
    heartbeat:()=>heartbeat(),cleared:()=>cleared};
}

test("setup failure marks job failed and stops the heartbeat",async()=>{
  const f=await fixture({failSetup:true});
  await assert.rejects(f.run(),/database unavailable/);
  assert.equal(f.updates.at(-1).status,"FAILED");
  assert.equal(f.cleared(),true);
});

test("index submission failure never advances the saved cursor",async()=>{
  const f=await fixture({failIndex:true});await assert.rejects(f.run(),/index unavailable/);
  assert.equal(f.updates.at(-1).status,"FAILED");
  assert.ok(!f.updates.some(update=>update.cursor));
});

test("end-cursor resume finishes finalization with a live heartbeat before completing",async()=>{
  let finish;const gate=new Promise(resolve=>{finish=resolve;});
  const f=await fixture({finalizationGate:gate});const running=f.run();
  await new Promise(resolve=>setTimeout(resolve,20));await f.heartbeat();
  assert.ok(f.updates.some(update=>update.updatedAt));
  assert.ok(!f.updates.some(update=>update.status==="COMPLETED"));
  finish();await running;
  assert.equal(f.updates.at(-1).status,"COMPLETED");
  assert.equal(f.cleared(),true);
});


test("queued errors let the worker decide retry status without briefly reporting terminal failure", async () => {
  const f = await fixture({failIndex:true});
  await assert.rejects(f.run({markFailure:false}), /index unavailable/);
  assert.ok(!f.updates.some(update => update.status === "FAILED"));
  assert.equal(f.cleared(),true);
});
