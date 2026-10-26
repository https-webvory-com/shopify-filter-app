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
