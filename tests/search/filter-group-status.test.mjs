import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function loadAction(prisma, invalidateShop) {
  const source = await fs.readFile('app/routes/app.filters.groups._index.jsx', 'utf8');
  const ast = ts.createSourceFile('route.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const initializer = ast.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'action')).declarationList.declarations[0].initializer.getText(ast);
  return vm.runInNewContext('(' + initializer + ')', {
    prisma, invalidateShop,
    authenticate: {admin: async () => ({session: {shop: 'fixture.myshopify.com'}})},
  });
}

for (const status of [true, false]) {
  test(`group toggle ${status ? 'off' : 'on'} invalidates storefront configuration before success`, async () => {
    const events = [];
    const action = await loadAction({filterGroup: {
      findUnique: async () => ({status}),
      update: async value => events.push(['saved', value.data.status]),
    }}, async shop => {
      await Promise.resolve();
      events.push(['invalidated', shop]);
    });
    const result = await action({request: new Request('http://fixture/app', {
      method: 'POST', body: new URLSearchParams({intent: 'toggle', id: 'default'}),
    })});
    assert.equal(result.success, true);
    assert.deepEqual(events, [['saved', !status], ['invalidated', 'fixture.myshopify.com']]);
  });
}

test('a failed group write does not report success or invalidate configuration', async () => {
  let invalidated = false;
  const action = await loadAction({filterGroup: {
    findUnique: async () => ({status: true}),
    update: async () => {throw new Error('Write failed');},
  }}, async () => {invalidated = true;});
  await assert.rejects(action({request: new Request('http://fixture/app', {
    method: 'POST', body: new URLSearchParams({intent: 'toggle', id: 'default'}),
  })}), /Write failed/);
  assert.equal(invalidated, false);
});

test('group settings save only canonical collection IDs from the authenticated store', async () => {
  const source = await fs.readFile('app/routes/app.filters.groups.$id.jsx', 'utf8');
  const ast = ts.createSourceFile('route.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const initializer = ast.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'action')).declarationList.declarations[0].initializer.getText(ast);
  const writes = [];
  const own = {id:'gid://shopify/Collection/123',title:'Formal'};
  const prisma = {
    filterGroup: {
      findFirst: async ({where}) => typeof where.id === 'string' ? {id:where.id,shop:where.shop} : null,
      update: async value => writes.push(['group',value]),
    },
    collection: {findMany: async ({where}) => {
      assert.equal(where.shop,'fixture.myshopify.com');
      return where.id.in.includes(own.id) ? [own] : [];
    }},
    filterGroupCollection: {
      deleteMany: async value => writes.push(['delete',value]),
      createMany: async value => writes.push(['create',value]),
    },
  };
  const action = vm.runInNewContext('(' + initializer + ')', {
    prisma, invalidateShop: async () => writes.push(['invalidate']),
    authenticate: {admin: async () => ({session: {shop:'fixture.myshopify.com'}})},
  });
  const save = selected => action({params:{id:'group'},request:new Request('http://fixture/app',{
    method:'POST',body:new URLSearchParams({intent:'updateGroupSettings',name:'New Filter',groupType:'collections',selectedCollections:JSON.stringify(selected)}),
  })});
  const invalid = await save([{id:'gid://shopify/Collection/Formal',title:'Formal'}]);
  assert.equal(invalid.success,false);
  assert.equal(writes.length,0);
  const valid = await save([{...own,title:'Untrusted title'}]);
  assert.equal(valid.success,true);
  assert.deepEqual(JSON.parse(JSON.stringify(writes.find(([kind]) => kind==='create')[1].data)),[
    {filterGroupId:'group',collectionId:own.id,collectionTitle:'Formal',pageType:'collection'},
  ]);
});

test('new groups reject collection IDs from outside the authenticated store', async () => {
  const writes=[];
  const action=await loadAction({
    collection:{findMany:async({where})=>{assert.equal(where.shop,'fixture.myshopify.com');return []; }},
    filterGroup:{create:async value=>writes.push(value)},
  },async()=>writes.push('invalidated'));
  const result=await action({request:new Request('http://fixture/app',{
    method:'POST',body:new URLSearchParams({intent:'create',name:'Formal',groupType:'collections',selectedCollections:JSON.stringify([{id:'gid://shopify/Collection/999',title:'Formal'}])}),
  })});
  assert.equal(result.success,false);
  assert.equal(writes.length,0);
});
