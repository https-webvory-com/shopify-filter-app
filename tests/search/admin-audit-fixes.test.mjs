import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const shop = 'fixture.myshopify.com';
async function loadAction(file, prisma, invalidateShop = async () => {}) {
  const source = await fs.readFile(`app/routes/${file}`, 'utf8');
  const ast = ts.createSourceFile('route.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const declaration = ast.statements.flatMap(s => ts.isVariableStatement(s) ? [...s.declarationList.declarations] : []).find(d => d.name.getText(ast) === 'action');
  const expression = declaration.initializer.getText(ast).replace('const { invalidateShop } = await import("../services/shopCache.server");', '')
    .replaceAll("await import('../services/collectionPreparation.server.js')", '({getCollectionPreparationRevision:async()=>"0",rememberCollectionPinReorder:async()=>false,rememberCollectionPinCreation:async()=>false})');
  return vm.runInNewContext(`(${expression})`, {prisma, invalidateShop, Response,
    data: (body, init) => Response.json(body, init), redirect: location => new Response(null, {status:302, headers:{Location:location}}),
    authenticate:{admin:async()=>({session:{shop}})}});
}
const request = values => new Request('http://fixture/app', {method:'POST', body:new URLSearchParams(values)});

test('editing disabled collection pins preserves status and enforces collection ownership', async () => {
  let written, invalidated = false;
  const action = await loadAction('app.collections.pinning.$id.jsx', {pinnedProductRule:{
    findFirst:async ({where}) => {assert.equal(where.shop, shop); assert.equal(where.ruleType, 'collection'); return {status:false, applyToAll:true};},
    update:async value => {written=value; return value;},
  }}, async () => {invalidated=true;});
  const result = await action({params:{id:'disabled'}, request:request({intent:'save', name:'Disabled', products:'[]',collections:'[]',applyToAll:'true'})});
  assert.equal(result.status,302); assert.equal(invalidated,true);
  assert.equal(Object.hasOwn(written.data,'status'),false);
  assert.equal(written.where.shop,shop); assert.equal(written.where.ruleType,'collection');
});

test('blank new collection pins are rejected before writes and invalidation', async () => {
  const action = await loadAction('app.collections.pinning.$id.jsx', {pinnedProductRule:{create:()=>assert.fail('must not save')}}, ()=>assert.fail('must not invalidate'));
  const result = await action({params:{id:'new'},request:request({intent:'save',products:'[]',collections:'[]',applyToAll:'false'})});
  assert.equal(result.status,400);
});

test('collection pin editor cannot overwrite a search rule or another shop', async () => {
  const action = await loadAction('app.collections.pinning.$id.jsx', {pinnedProductRule:{findFirst:async()=>null, update:()=>assert.fail('must not update')}});
  assert.equal((await action({params:{id:'foreign'},request:request({intent:'save',products:'[]',collections:'[]'})})).status,404);
});

for (const intent of ['toggle','duplicate']) test(`filter group ${intent} cannot read another shop`, async () => {
  const action = await loadAction('app.filters.groups._index.jsx', {filterGroup:{findUnique:async ({where})=>{assert.equal(where.shop,shop);return null;},update:()=>assert.fail('must not write')}});
  assert.equal((await action({request:request({intent,id:'foreign'})})).success,false);
});

for (const intent of ['update','delete','toggle_status']) test(`merged value ${intent} scopes every mutation to the shop`,async()=>{
  const check=async ({where})=>{assert.equal(where.shop,shop);assert.equal(where.id,'foreign');throw Error('Not found');};
  const action=await loadAction('app.filters.merged-value.jsx',{mergedValue:{update:check,delete:check}},()=>assert.fail('must not invalidate'));
  await assert.rejects(action({request:request({intent,id:'foreign',targetValue:'x',sourceValues:'a'})}),/Not found/);
});

for(const intent of ['toggleFilter','duplicateFilter'])test(`child filter ${intent} requires membership in the verified parent`,async()=>{
  const action=await loadAction('app.filters.groups.$id.jsx',{filterGroup:{findFirst:async({where})=>{assert.equal(where.shop,shop);return{id:'own'};}},filterGroupItem:{findUnique:async({where})=>{assert.equal(where.filterGroupId,'own');return null;},create:()=>assert.fail('must not copy')}});
  const result=await action({params:{id:'own'},request:request({intent,filterId:'foreign'})});
  assert.ok(result.success===false||result.status===404);
});
