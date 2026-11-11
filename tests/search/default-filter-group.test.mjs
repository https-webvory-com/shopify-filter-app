import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {loadModule} from './helpers/search-ranking.mjs';

async function fixture(existing = null, {conflicts = 0, failure} = {}) {
  const events = [];
  const tx = {
    filterGroup:{findFirst:async args => {events.push(['read',args]);return existing;},create:async args => events.push(['create',args])},
    filterGroupCollection:{create:async args => events.push(['collection',args])},
    filterGroupItem:{createMany:async args => events.push(['filters',args])},
  };
  const prisma = {$transaction:async (run, options) => {
    assert.equal(options.isolationLevel,'Serializable');
    if (conflicts-- > 0) throw Object.assign(Error('Concurrent setup'),{code:'P2034'});
    if (failure) throw failure;
    const result=await run(tx);events.push(['committed']);return result;
  }};
  const service=await loadModule('app/services/defaultFilterGroup.server.js',{
    '../db.server':{default:prisma},'./shopCache.server':{invalidateShop:async shop => events.push(['invalidate',shop])},
  });
  return {...service,events};
}

test('first app entry creates all default filters atomically and invalidates empty storefront preparations',async()=>{
  const f=await fixture();assert.equal(await f.ensureDefaultGroup('new.myshopify.com'),true);
  const data=f.events.find(([kind])=>kind==='create')[1].data;
  assert.equal(data.shop,'new.myshopify.com');assert.equal(data.isDefault,true);assert.equal(data.status,true);
  assert.deepEqual(Array.from(data.filters.create,f=>f.filterType+':'+(f.filterKey||'')),['price:','vendor:','product_type:','collection:','option:Color','option:Size']);
  assert.equal(data.collections.create[0].collectionId,'__all__');
  assert.deepEqual(f.events.slice(-2),[['committed'],['invalidate','new.myshopify.com']]);
});

test('ordinary app entry preserves a disabled or deliberately customized existing default group',async()=>{
  const f=await fixture({id:'merchant',status:false,collections:[],filters:[]});
  assert.equal(await f.ensureDefaultGroup('existing.myshopify.com'),false);
  assert.deepEqual(f.events.map(([kind])=>kind),['read','committed']);
  assert.equal(f.events[0][1].where.shop,'existing.myshopify.com');
});

test('editor repair only inserts missing defaults and invalidates after commit',async()=>{
  const f=await fixture({id:'legacy',collections:[],filters:[{filterType:'price',filterKey:null,label:'My price',isEnabled:false}]});
  assert.equal(await f.ensureDefaultGroup('legacy.myshopify.com',{repair:true}),true);
  const added=f.events.find(([kind])=>kind==='filters')[1].data;
  assert.equal(added.length,5);assert.ok(added.every(row=>row.filterGroupId==='legacy'&&row.filterType!=='price'));
  assert.deepEqual(f.events.slice(-2),[['committed'],['invalidate','legacy.myshopify.com']]);
});

test('serializable setup retries concurrent conflicts without duplicate successful writes',async()=>{
  const f=await fixture(null,{conflicts:2});assert.equal(await f.ensureDefaultGroup('race.myshopify.com'),true);
  assert.equal(f.events.filter(([kind])=>kind==='create').length,1);
  assert.equal(f.events.filter(([kind])=>kind==='invalidate').length,1);
});

test('failed or exhausted setup never invalidates storefront state or reports success',async()=>{
  for(const options of [{conflicts:3},{failure:Error('Database unavailable')}]){
    const f=await fixture(null,options);await assert.rejects(f.ensureDefaultGroup('failed.myshopify.com'));
    assert.ok(!f.events.some(([kind])=>kind==='invalidate'));
  }
});

test('authenticated app shell initializes the owning shop before exposing setup screens',async()=>{
  const source=await fs.readFile('app/routes/app.jsx','utf8');
  const ast=ts.createSourceFile('route.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const initializer=ast.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)==='loader')).declarationList.declarations[0].initializer.getText(ast);
  const events=[];
  const loader=vm.runInNewContext('('+initializer+')',{
    authenticate:{admin:async()=>{events.push('authenticated');return {session:{shop:'own.myshopify.com'}};}},
    ensureDefaultGroup:async shop=>events.push(shop),process:{env:{SHOPIFY_API_KEY:'fixture'}},
  });
  assert.equal((await loader({request:new Request('https://fixture/app')})).apiKey,'fixture');
  assert.deepEqual(events,['authenticated','own.myshopify.com']);
});
