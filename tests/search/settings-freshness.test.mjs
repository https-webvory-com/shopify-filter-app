import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {loadModule} from './helpers/search-ranking.mjs';

async function action(file, dependencies) {
  const source=await fs.readFile(file,'utf8');
  const ast=ts.createSourceFile('route.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const initializer=ast.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)==='action')).declarationList.declarations[0].initializer.getText(ast);
  return vm.runInNewContext('('+initializer+')',{
    authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})},...dependencies,
  });
}
const request=values=>new Request('http://fixture/admin',{method:'POST',body:new URLSearchParams(values)});

test('wishlist save preserves filter layout and waits for invalidation; malformed values cannot reset settings',async()=>{
  const writes=[];let release,finished=false;
  const save=await action('app/routes/app.settings.integrations.jsx',{
    prisma:{filterGlobalSetting:{findUnique:async()=>({integrations:{desktopFilterLayout:'vertical'}}),upsert:async value=>writes.push(value)}},
    invalidateShop:()=>new Promise(resolve=>{release=resolve;}),
  });
  const pending=save({request:request({integrations:'{"wishlist":true}'})}).then(value=>{finished=true;return value;});
  while(!release)await Promise.resolve();
  assert.equal(finished,false);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].update.integrations)),{desktopFilterLayout:'vertical',wishlist:true});
  release();assert.equal((await pending).success,true);
  for(const value of ['bad','null','[]','{}','{"wishlist":"false"}'])assert.equal((await save({request:request({integrations:value})})).success,false);
  assert.equal(writes.length,1);
});

for(const [file,intent,form,model] of [
  ['app.filters.merged-value.jsx','toggle_status',{id:'merged',isActive:'false'},'mergedValue'],
  ['app.filters.groups.$id.jsx','toggleFilter',{filterId:'color'},'filterGroupItem'],
])test(`${intent} cannot report saved before storefront invalidation finishes`,async()=>{
  let release,finished=false;const events=[];
  const save=await action('app/routes/'+file,{
    prisma:{filterGroup:{findFirst:async()=>({id:'group'})},[model]:{findUnique:async()=>({isEnabled:true}),update:async()=>events.push('write')}},
    invalidateShop:()=>{events.push('invalidate');return new Promise(resolve=>{release=resolve;});},
  });
  const pending=save({request:request({intent,...form}),params:{id:'group'}}).then(value=>{finished=true;return value;});
  while(!release)await Promise.resolve();
  assert.equal(finished,false);assert.deepEqual(events,['write','invalidate']);
  release();assert.equal((await pending).success,true);
});

test('synonyms wait for index completion before invalidating; failed tasks cannot report applied',async()=>{
  for(const status of ['succeeded','failed']){
    const events=[];
    const service=await loadModule('app/services/synonyms.server.js',{
      '../db.server':{default:{synonym:{findMany:async()=>[{word:'gown',synonyms:'dress'}]}}},
      './meiliClient.server':{default:{index:()=>({updateSynonyms:async()=>{events.push('queued');return {taskUid:7};}}),tasks:{waitForTask:async id=>{assert.equal(id,7);events.push('completed');return {status};}}}},
      './shopCache.server':{invalidateShop:async()=>events.push('invalidated')},
    });
    assert.equal(await service.syncSynonymsToMeilisearch('fixture.myshopify.com'),status==='succeeded');
    assert.deepEqual(events,status==='succeeded'?['queued','completed','invalidated']:['queued','completed']);
  }
});

for(const actionType of ['createRule','editRule','deleteRule','toggleRule','duplicateRule'])test(`search merchandising ${actionType} refreshes storefront state before success`,async()=>{
  const events=[];
  const model={create:async()=>{events.push('write');return {};},update:async()=>{events.push('write');return {};},
    deleteMany:async()=>events.push('write'),updateMany:async()=>events.push('write'),findFirst:async()=>({name:'Rule',conditions:[]})};
  const save=await action('app/routes/app.search.merchandising.jsx',{
    Response,prisma:{merchandisingRule:model,merchandisingRuleCondition:{deleteMany:async()=>{}}},invalidateShop:async()=>events.push('invalidated'),
  });
  const result=await save({request:request({actionType,id:'rule',conditions:'[]',searchQueries:'["dress"]'})});
  assert.equal((await result.json()).success,true);assert.deepEqual(events,['write','invalidated']);
});
