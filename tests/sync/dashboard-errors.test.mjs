import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { syncErrorMessage, syncIssueForJob } from "../../app/utils/syncError.js";

async function routeFixture(job) {
  const prisma={product:{count:async()=>500},syncJob:{findFirst:async({where})=>where.status===job.status?job:null}};
  const mocks={
    "../shopify.server":{authenticate:{admin:async()=>({session:{shop:"fixture.myshopify.com"}})}},
    "../db.server":{__esModule:true,default:prisma},
    "../utils/syncError.js":{syncErrorMessage,syncIssueForJob},
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
