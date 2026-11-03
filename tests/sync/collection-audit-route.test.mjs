import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

test('authenticated collection audit accepts only a collection owned by the session shop', async () => {
  const shop='fixture.myshopify.com', calls=[];
  const source=await fs.readFile('app/routes/app.api.collection-audit.jsx','utf8');
  const mocks={
    '../shopify.server':{authenticate:{admin:async()=>({session:{shop}})}},
    '../db.server':{__esModule:true,default:{collection:{findFirst:async({where})=>where.shop===shop&&where.handle==='prom-dresses'
      ?{id:'gid://shopify/Collection/1',handle:where.handle}:null}}},
    '../services/redis.server.js':{__esModule:true,default:{get:async()=>JSON.stringify({verified:true,products:3})}},
    '../services/collectionMembershipAudit.server.js':{enqueueCollectionMembershipAudit:async(...args)=>{calls.push(args);return{jobId:'job',status:'queued'};}},
  };
  const ctx={module:{exports:{}},exports:{},URL,Response,require:name=>mocks[name]};
  vm.runInNewContext((await transform(source,{loader:'jsx',format:'cjs'})).code,ctx);
  const {loader,action}=ctx.module.exports;
  const missing=await action({request:new Request('https://app.test/app/api/collection-audit',{method:'POST',body:new URLSearchParams({handle:'other'})})});
  assert.equal(missing.status,404);assert.equal(calls.length,0);
  const queued=await action({request:new Request('https://app.test/app/api/collection-audit',{method:'POST',body:new URLSearchParams({handle:'prom-dresses'})})});
  assert.equal(queued.status,202);assert.deepEqual(Array.from(calls[0]),[shop,'gid://shopify/Collection/1']);
  const status=await loader({request:new Request('https://app.test/app/api/collection-audit?handle=prom-dresses')});
  assert.equal((await status.json()).status.products,3);
});
