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
    findFirst:async()=>({shop:'fixture.myshopify.com',name:'Pins',status:true,applyToAll:false,collections:['Collection'],products:[],collectionSortKey:'[99]',collectionSortPosition:7}),
  };
  const source=(await fs.readFile(file,'utf8'))
    .replace('await import("../services/shopCache.server")','require("../services/shopCache.server")')
    .replaceAll("await import('../services/collectionPreparation.server.js')","require('../services/collectionPreparation.server.js')");
  const ctx={module:{exports:{}},exports:{},Response,console,require:name=>{
    if(name==='../shopify.server')return {authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})}};
    if(name==='../db.server')return {__esModule:true,default:{pinnedProductRule:model}};
    if(name==='../services/shopCache.server')return {invalidateShop:async shop=>invalidations.push(shop)};
    if(name==='../services/collectionPreparation.server.js')return {getCollectionPreparationRevision:async()=>String(invalidations.length),rememberCollectionPinReorder:async()=>false,rememberCollectionPinCreation:async()=>false};
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

test('collection pin duplicate retains source display metadata',async()=>{
  const f=await route('app/routes/app.collections.pinning._index.jsx');
  await f.action({request:new Request('https://fixture/app/collections/pinning',{method:'POST',body:new URLSearchParams({actionType:'duplicateRule',id:'pin'})})});
  assert.equal(f.mutations[0].data.collectionSortKey,'[99]');
  assert.equal(f.mutations[0].data.collectionSortPosition,7);
});

test('collection pin edits preserve source order for product-only changes and clear it for new targets',async()=>{
  for(const [collections,all,changed] of [['["Collection"]','false',false],['["Other"]','false',true],['[]','true',true]]) {
    const f=await route('app/routes/app.collections.pinning.$id.jsx');
    const form=new URLSearchParams({intent:'save',name:'Pins',products:'[{"id":"new-product"}]',collections,applyToAll:all});
    await f.action({request:new Request('https://fixture/app/collections/pinning/pin',{method:'POST',body:form}),params:{id:'pin'}});
    assert.equal(f.mutations[0].data.collectionSortKey,changed?null:undefined);
    assert.equal(f.mutations[0].data.collectionSortPosition,changed?null:undefined);
  }
});

for(const id of ['new','existing'])test(`collection pin editor ${id} save invalidates its ranking`,async()=>{
  const f=await route('app/routes/app.collections.pinning.$id.jsx');
  const form=new URLSearchParams({intent:'save',name:'Pins',products:'[{"id":"gid://shopify/Product/1"}]',collections:'["Collection"]'});
  await f.action({request:new Request('https://fixture/app/collections/pinning/'+id,{method:'POST',body:form}),params:{id}});
  assert.deepEqual(f.invalidations,['fixture.myshopify.com']);assert.equal(f.mutations.length,1);
});

for(const actionType of ['deleteRule','bulkDeleteRules','duplicateRule','toggleStatus'])test(`search pin ${actionType} invalidates storefront configuration`,async()=>{
  const f=await route('app/routes/app.search.pinning._index.jsx');
  const form=new URLSearchParams({actionType,id:'pin',ids:'["pin"]',status:'true'});
  assert.equal((await f.action({request:new Request('https://fixture/app/search/pinning',{method:'POST',body:form})})).success,true);
  assert.deepEqual(f.invalidations,['fixture.myshopify.com']);
});

for(const id of ['new','existing'])test(`search pin editor ${id} save invalidates before redirect`,async()=>{
  const f=await route('app/routes/app.search.pinning.$id.jsx');
  const form=new URLSearchParams({intent:'save',name:'Pins',products:'[{"id":"product"}]',searchQueries:'["dress"]'});
  await f.action({request:new Request('https://fixture/app/search/pinning/'+id,{method:'POST',body:form}),params:{id}});
  assert.deepEqual(f.invalidations,['fixture.myshopify.com']);assert.equal(f.mutations.length,1);
});
