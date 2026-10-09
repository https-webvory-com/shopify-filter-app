import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { syncErrorMessage, syncIssueForJob, productSyncJobWhere, isCompletedSyncTransition } from "../../app/utils/syncError.js";

async function routeFixture(job, queueState = "missing") {
  const prisma={product:{count:async()=>48860},syncJob:{
    findFirst:async({where})=>where.status ? (job.status===where.status && job.completedAt ? job : null) : job,
    update:async({data})=>Object.assign(job,data),
  }};
  const mocks={
    "../shopify.server":{authenticate:{admin:async()=>({session:{shop:"fixture.myshopify.com"}})}},
    "../db.server":{__esModule:true,default:prisma},
    "../utils/syncError.js":{syncErrorMessage,syncIssueForJob,productSyncJobWhere,isCompletedSyncTransition},
    "../services/productSyncQueue.server.js":{productSyncQueue:{getJob:async()=>queueState === "missing" ? null : {getState:async()=>queueState,failedReason:"Shopify unavailable"}}},
    "react/jsx-runtime":jsxRuntime,
  };
  const ctx={module:{exports:{}},exports:{},console,require:name=>mocks[name]||{}};
  vm.runInNewContext((await transform(await fs.readFile("app/routes/app._index.jsx","utf8"),{format:"cjs",loader:"jsx",jsx:"automatic"})).code,ctx);
  return ctx.module.exports.loader({request:new Request("https://fixture.test/app")});
}

test("dashboard exposes temporary errors and saved progress during automatic retry",async()=>{
  const result=await routeFixture({id:"job",status:"IN_PROGRESS",lastError:"Search indexing failed",retryCount:2,productsProcessed:138,totalProducts:500,updatedAt:new Date()});
  assert.equal(result.syncIssue.retrying,true);
  assert.equal(result.syncIssue.retryCount,2);
  assert.equal(result.syncIssue.processed,138);
  assert.equal(result.latestSyncStatus,"IN_PROGRESS");
});

test("finalization failure stays visible even when all products have been processed",async()=>{
  const result=await routeFixture({id:"job",status:"FAILED",lastError:"Sales ranking update did not finish",retryCount:10,productsProcessed:500,totalProducts:500});
  assert.equal(result.latestSyncStatus,"FAILED");
  assert.equal(result.syncIssue.retrying,false);
  assert.equal(result.syncIssue.processed,500);
  assert.equal(result.lastSyncedAt,null);
});

test("completed sync has no stale error banner",()=>{
  assert.equal(syncIssueForJob({status:"COMPLETED",lastError:"old failure"}),null);
});

test("displayed errors classify failures without exposing raw credentials or database queries",()=>{
  assert.match(syncErrorMessage(Error("502 Bad Gateway")),/could not be reached/);
  assert.match(syncErrorMessage(Error("Meilisearch disk full")),/disk space/);
  assert.match(syncErrorMessage(Error("429 quota exhausted")),/request limit/);
  const shown=syncErrorMessage(Error("unexpected secret-token postgres-password query"));
  assert.ok(!shown.includes("secret-token"));assert.ok(!shown.includes("postgres-password"));
});

test("error banner renders retry information and a stopped sync with resume instructions",async()=>{
  const ctx={module:{exports:{}},exports:{},require:()=>jsxRuntime};
  vm.runInNewContext((await transform(await fs.readFile("app/components/ui/SyncErrorBanner.jsx","utf8"),{format:"cjs",loader:"jsx",jsx:"automatic"})).code,ctx);
  const Banner=ctx.module.exports.default;
  const pending=renderToStaticMarkup(React.createElement(Banner,{issue:{message:"Connection unavailable",retrying:true,retryCount:2,processed:138}}));
  assert.match(pending,/role="alert"/);assert.match(pending,/recovering automatically/);assert.match(pending,/attempt 2 of 10/);
  const failed=renderToStaticMarkup(React.createElement(Banner,{issue:{message:"Indexing failed",retrying:false,processed:500}}));
  assert.match(failed,/Sync did not complete/);assert.match(failed,/Resume Sync/);assert.match(failed,/500 products processed/);
});


test("stopped progress stays at 21800 even when 48860 products already exist in the database", async () => {
  const result = await routeFixture({id:"current",kind:"PRODUCTS",status:"FAILED",productsProcessed:21800,totalProducts:48860,lastError:"Indexing failed"});
  assert.equal(result.syncedProductsCount,48860);
  assert.equal(result.syncProgress.processed,21800);
  assert.equal(result.syncProgress.total,48860);
  assert.equal(result.latestSyncId,"current");
  assert.equal(result.latestSyncStatus,"FAILED");
});

test("a legacy completion flag without verification is resumable, never a success", async () => {
  const result = await routeFixture({id:"old",status:"COMPLETED",cursor:"at-21800",productsProcessed:21800,totalProducts:48860});
  assert.equal(result.latestSyncStatus,"FAILED");
  assert.equal(result.resumableJob.processed,21800);
  assert.equal(result.lastSyncedAt,null);
});

test("only the same running job can trigger a completion notification", () => {
  const running={id:"current",status:"IN_PROGRESS"};
  assert.equal(isCompletedSyncTransition(running,{id:"old-order-sync",status:"COMPLETED"}),false);
  assert.equal(isCompletedSyncTransition(running,{id:"current",status:"FAILED"}),false);
  assert.equal(isCompletedSyncTransition(running,{id:"current",status:"COMPLETED"}),true);
});

async function renderDashboard(data, stats = null) {
  if(stats) stats={totalProducts:51,draftProducts:0,archivedProducts:0,allCollections:16,publishedCollections:15,smartCollections:2,...stats};
  const mocks={
    react:{useEffect(){},useRef:()=>({current:null})},
    "react/jsx-runtime":jsxRuntime,
    "react-router":{useLoaderData:()=>data,useFetcher:()=>({state:"idle",data:stats}),useRevalidator:()=>({revalidate(){}}),useNavigate:()=>()=>{}},
    "@shopify/app-bridge-react":{useAppBridge:()=>({toast:{show(){}}})},
    "../components/ui/LoadingSpinner":{__esModule:true,default:()=>React.createElement("span",null,"Loading")},
    "../components/ui/SyncErrorBanner":{__esModule:true,default:()=>React.createElement("div",{"data-sync-error-banner":true},"Sync did not complete")},
  };
  const ctx={module:{exports:{}},exports:{},require:name=>mocks[name]||{}};
  vm.runInNewContext((await transform(await fs.readFile("app/routes/app._index.jsx","utf8"),{format:"cjs",loader:"jsx",jsx:"automatic"})).code,ctx);
  return renderToStaticMarkup(React.createElement(ctx.module.exports.default));
}

test("the actual dashboard keeps stopped progress instead of rendering database count as completion", async () => {
  const result=await routeFixture({id:"current",status:"FAILED",productsProcessed:21800,totalProducts:48860,lastError:"Indexing failed"});
  const html=await renderDashboard(result);
  const section=html.slice(html.indexOf("Database Synchronization"));
  assert.match(section,/21,800/);
  assert.match(section,/sync stopped/);
  assert.match(section,/45%/);
  assert.ok(!section.includes("Fully Synced"));
  assert.ok(!section.includes("48,860 active products synced"));
});

test("queued sync is not failed after five minutes without a worker heartbeat", async () => {
  for (const state of ["waiting", "delayed", "active", "prioritized"]) {
    const result = await routeFixture({id:"small-store",status:"IN_PROGRESS",productsProcessed:45,totalProducts:51,updatedAt:new Date(Date.now()-3600000)}, state);
    assert.equal(result.latestSyncStatus,"IN_PROGRESS");
    assert.equal(result.syncIssue,null);
    assert.equal(result.syncQueueState,state);
  }
});
test("a dashboard timeout is repaired when its queue job is still pending", async () => {
  const result = await routeFixture({id:"small-store",status:"FAILED",lastError:"Sync stopped sending progress updates",productsProcessed:45,totalProducts:51}, "waiting");
  assert.equal(result.latestSyncStatus,"IN_PROGRESS");
  assert.equal(result.syncIssue,null);
});
test("an actual failed queue job exposes a safe worker error", async () => {
  const result = await routeFixture({id:"small-store",status:"IN_PROGRESS",productsProcessed:45,totalProducts:51,updatedAt:new Date()}, "failed");
  assert.equal(result.latestSyncStatus,"FAILED");
  assert.match(result.syncIssue.message,/could not be reached/);
});

test("verified unpublished products are explained separately from a waiting scan",async()=>{
  const data=await routeFixture({id:"small-store",status:"IN_PROGRESS",productsProcessed:45,totalProducts:51,updatedAt:new Date()},"waiting");
  data.syncedProductsCount=45;
  const html=await renderDashboard(data,{activeProducts:51,publishedProducts:45,unpublishedProducts:6});
  assert.match(html,/6 unpublished products excluded from listings/);
  assert.ok(html.includes("45 products in database / 45 published products"));
  assert.match(html,/Sync is queued/);
  assert.ok(!html.includes("Fully Synced"));
});
test("a database count difference alone is never labelled unpublished",async()=>{
  const data=await routeFixture({id:"small-store",status:"FAILED",productsProcessed:45,totalProducts:51,lastError:"Indexing failed"});
  data.syncedProductsCount=45;
  const html=await renderDashboard(data,{activeProducts:51});
  assert.ok(!html.includes("unpublished products excluded"));
});

test("dashboard hides the sync error box while keeping stopped progress and recovery controls",async()=>{
  const data=await routeFixture({id:"stopped",status:"FAILED",productsProcessed:45,totalProducts:51,lastError:"Shopify pagination stopped before all products were read"});
  const html=await renderDashboard(data);
  assert.ok(!html.includes("data-sync-error-banner"));
  assert.ok(!html.includes("Sync did not complete"));
  assert.match(html,/sync stopped/);
  assert.match(html,/Resume Sync/);
});
