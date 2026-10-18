import { syncErrorMessage, productSyncJobWhere } from "../../app/utils/syncError.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import { isStorefrontProduct } from "../../app/utils/storefrontProduct.js";
import * as searchProjection from '../../app/utils/searchIndexProjection.js';
import * as memberships from '../../app/services/productCollections.server.js';

async function fixture({ failSetup = false, failIndex = false, failMembership = false, finalizationGate, processed = 6900, total = 6900, morePages = false } = {}) {
  const updates = [];
  let heartbeat, cleared = false;
  const job = { id: "job", status: "IN_PROGRESS", cursor: "last-saved", productsProcessed: processed };
  const prisma = {
    syncJob: {
      findUnique: async () => job,
      update: async ({data}) => { updates.push(data); return job; },
      updateMany: async ({data}) => { updates.push(data); return {count:1}; },
    },
    filterSetting: {findMany: async () => {if(failSetup) throw Error("database unavailable"); return []; }},
    product: {deleteMany: async () => {},findMany:async()=>[{id:'gid://shopify/Product/1',collections:[]}]},
    $queryRaw: async () => [],
  };
  let indexed=[];
  const index = new Proxy({
    deleteDocument: async () => {},
    addDocuments: async docs => { if(failIndex) throw Error("index unavailable"); indexed=docs;return {taskUid:1}; },
    search:async()=>({hits:indexed}),
  }, {get: (target,key) => target[key] || (async () => ({}))});
  const mocks = {
    './productCollections.server.js':memberships,
    '../utils/searchIndexProjection.js': searchProjection,
    "../utils/syncError.js": { syncErrorMessage, productSyncJobWhere },
    "../db.server": {__esModule:true,default:prisma},
    "./meiliClient.server": {__esModule:true,default:{index:()=>index,tasks:{waitForTask:async()=>({status:"succeeded"})}}},
    "./shopCache.server": {invalidateShop: async () => {}},
    "../utils/storefrontProduct.js": {isStorefrontProduct},
    "../utils/semanticSearch.js": {},
  };
  const source = (await fs.readFile("app/services/sync.server.js","utf8"))
    .replace('await import("./orders.server.js")','({syncHistoricalOrders: finishOrders})')
    .replace('await smartUpsertProduct(shop, product, prisma);','await pretendPersist(product);');
  const context = {module:{exports:{}}, exports:{}, require:name=>mocks[name],
    process:{env:{}}, console:{log(){},error(){},warn(){}},
    setTimeout: callback=>callback(), setInterval: callback=>{heartbeat=callback;return {unref(){}};},
    clearInterval:()=>{cleared=true;}, finishOrders:async()=>{if(finalizationGate) await finalizationGate;},
    pretendPersist:async()=>{},
  };
  vm.runInNewContext((await transform(source,{format:"cjs"})).code,context);
  const admin = {graphql:async (query,{variables}={})=>({json:async()=>{
    if(query.includes("verifyProductSyncCount")) return {data:{productsCount:{count:total,precision:"EXACT"}}};
    if(query.includes("getPublishedCollections")) return {data:{collections:{nodes:[],pageInfo:{hasNextPage:false}}}};
    assert.equal(variables.cursor,"last-saved");
    assert.ok(query.includes("products(first: 10"));
    return {data:{products:{nodes:failMembership?[{id:'gid://shopify/Product/1',status:'ACTIVE',publishedAt:'2026-10-18',options:[],images:{nodes:[]},tags:[],variants:{nodes:[{id:'gid://shopify/ProductVariant/1',price:'100',availableForSale:true,inventoryQuantity:1,selectedOptions:[]}]},collections:{nodes:[{id:'gid://shopify/Collection/1'}],pageInfo:{hasNextPage:false}}}]:(failIndex || morePages)?[{id:"gid://shopify/Product/1",status:"DRAFT"}]:[],pageInfo:{hasNextPage:morePages,endCursor:"end"}}}};
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
test('persisting the product without its membership cannot advance the checkpoint',async()=>{
 const f=await fixture({failMembership:true});await assert.rejects(f.run(),/membership verification failed/);assert.ok(!f.updates.some(u=>u.cursor));assert.equal(f.updates.at(-1).status,'FAILED');
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


test("an early empty page at 21800 cannot complete a 48860 product sync", async () => {
  const f = await fixture({processed:21800,total:48860});
  await assert.rejects(f.run(), /unread products: 21800 \/ 48860/);
  assert.equal(f.updates.at(-1).status, "FAILED");
  assert.ok(!f.updates.some(update => update.status === "COMPLETED" || update.completedAt));
});


for (const status of ["FAILED", "COMPLETED"]) test("an unfinished " + status + " record resumes its saved 21800 checkpoint", async () => {
  const saved = {id:"same-job",shop:"fixture.myshopify.com",kind:"PRODUCTS",status,cursor:"cursor-21800",productsProcessed:21800,totalProducts:48860,completedAt:null};
  const calls=[];
  const prisma={syncJob:{findFirst:async({where})=>{assert.equal(where.shop,saved.shop);return saved;},update:async({data})=>Object.assign(saved,data),create:async()=>{throw Error("Should resume, not create another job");}}};
  const source=(await fs.readFile("app/services/sync.server.js","utf8"))
    .replace('await import("./productSyncQueue.server.js")','({enqueueProductSync: enqueue})');
  const mocks={"../db.server":{__esModule:true,default:prisma},"../utils/syncError.js":{syncErrorMessage,productSyncJobWhere}};
  const ctx={module:{exports:{}},exports:{},require:name=>mocks[name]||{},console:{log(){}},enqueue:async(id,shop)=>calls.push([id,shop])};
  vm.runInNewContext((await transform(source,{format:"cjs"})).code,ctx);
  const result=await ctx.module.exports.syncProducts(saved.shop,{});
  assert.equal(result.jobId,"same-job");assert.match(result.message,/21800/);
  assert.equal(saved.cursor,"cursor-21800");assert.equal(saved.productsProcessed,21800);
  assert.equal(saved.status,"IN_PROGRESS");assert.equal(calls.length,1);
});

test("a bounded sync turn saves the cursor and yields before finalization", async () => {
  const f=await fixture({morePages:true});
  const result=await f.run({markFailure:false,maxBatches:1});
  assert.equal(result.needsContinuation,true);
  assert.ok(f.updates.some(update=>update.cursor==="end" && update.productsProcessed.increment===1));
  assert.ok(!f.updates.some(update=>update.status==="COMPLETED" || update.status==="FAILED"));
  assert.equal(f.cleared(),true);
});
