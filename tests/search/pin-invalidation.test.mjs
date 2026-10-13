import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';

async function route(file) {
  const mutations=[],invalidations=[];
  const model={
    deleteMany:async args=>mutations.push(args),update:async args=>mutations.push(args),
    create:async args=>mutations.push(args),
    findFirst:async()=>({shop:'fixture.myshopify.com',name:'Pins',status:true,collections:['Collection'],products:[]}),
  };
  const source=(await fs.readFile(file,'utf8')).replace('await import("../services/shopCache.server")','require("../services/shopCache.server")');
  const ctx={module:{exports:{}},exports:{},Response,console,require:name=>{
    if(name==='../shopify.server')return {authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})}};
    if(name==='../db.server')return {__esModule:true,default:{pinnedProductRule:model}};
    if(name==='../services/shopCache.server')return {invalidateShop:async shop=>invalidations.push(shop)};
    if(name==='react-router')return {redirect:()=>({redirect:true})};
    return {};
  }};
  vm.runInNewContext((await transform(source,{loader:'jsx',format:'cjs'})).code,ctx);
  return {action:ctx.module.exports.action,mutations,invalidations};
}

for(const actionType of ['deleteRule','bulkDeleteRules','duplicateRule','toggleStatus'])test(`collection pin ${actionType} invalidates after the shop-scoped mutation`,async()=>{
  const f=await route('app/routes/app.collections.pinning._index.jsx');
  const form=new URLSearchParams({actionType,id:'pin',ids:'["pin"]',status:'true'});
  assert.equal((await f.action({request:new Request('https://fixture/app/collections/pinning',{method:'POST',body:form})})).success,true);
  assert.deepEqual(f.invalidations,['fixture.myshopify.com']);
  assert.equal(f.mutations[0].where?.shop??f.mutations[0].data.shop,'fixture.myshopify.com');
});

for(const id of ['new','existing'])test(`collection pin editor ${id} save invalidates its ranking`,async()=>{
  const f=await route('app/routes/app.collections.pinning.$id.jsx');
  const form=new URLSearchParams({intent:'save',name:'Pins',products:'[]',collections:'["Collection"]'});
  await f.action({request:new Request('https://fixture/app/collections/pinning/'+id,{method:'POST',body:form}),params:{id}});
  assert.deepEqual(f.invalidations,['fixture.myshopify.com']);assert.equal(f.mutations.length,1);
});
