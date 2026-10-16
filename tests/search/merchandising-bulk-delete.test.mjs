import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import {merchandisingRuleIds} from '../../app/utils/merchandisingSelection.js';

async function fixture(scope, fail = false) {
  const rows = [
    {id:'one',shop:'fixture.myshopify.com',ruleType:scope},
    {id:'two',shop:'fixture.myshopify.com',ruleType:scope},
    {id:'foreign',shop:'other.myshopify.com',ruleType:scope},
    {id:'other-type',shop:'fixture.myshopify.com',ruleType:scope === 'search' ? 'collection' : 'search'},
    {id:'untouched',shop:'fixture.myshopify.com',ruleType:scope},
  ];
  const mutations=[],invalidations=[];
  const source=(await fs.readFile(`app/routes/app.${scope === 'search' ? 'search' : 'collections'}.merchandising.jsx`,'utf8'))
    .replaceAll('await import("../services/shopCache.server")','require("../services/shopCache.server")');
  const mocks={
    '../shopify.server':{authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})}},
    '../db.server':{__esModule:true,default:{merchandisingRule:{deleteMany:async args=>{
      mutations.push(JSON.parse(JSON.stringify(args)));
      if(fail) throw Error('DB unavailable');
      const selected=rows.filter(r=>r.shop===args.where.shop && r.ruleType===args.where.ruleType && args.where.id.in.includes(r.id));
      for(const row of selected) rows.splice(rows.indexOf(row),1);
      return {count:selected.length};
    }}}},
    '../utils/merchandisingSelection.js':{merchandisingRuleIds},
    '../services/shopCache.server':{invalidateShop:async shop=>invalidations.push(shop)},
  };
  const ctx={module:{exports:{}},exports:{},Response,console,require:name=>mocks[name]||{}};
  vm.runInNewContext((await transform(source,{loader:'jsx',format:'cjs'})).code,ctx);
  const submit=ids=>ctx.module.exports.action({request:new Request('https://fixture/app',{method:'POST',body:new URLSearchParams({actionType:'bulkDeleteRules',ids})})});
  return {submit,rows,mutations,invalidations};
}

for(const scope of ['search','collection']) {
  test(`${scope}: bulk deletion validates IDs, scopes shop/type, deduplicates, invalidates and tolerates retries`,async()=>{
    const f=await fixture(scope);
    const ids=JSON.stringify(['one','two','one','foreign','other-type','missing']);
    const response=await f.submit(ids);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{success:true,intent:'bulkDelete',count:2});
    assert.deepEqual(f.rows.map(r=>r.id),['foreign','other-type','untouched']);
    assert.deepEqual(f.mutations[0].where,{shop:'fixture.myshopify.com',ruleType:scope,id:{in:['one','two','foreign','other-type','missing']}});
    assert.deepEqual(f.invalidations,['fixture.myshopify.com']);
    assert.equal((await (await f.submit(ids)).json()).count,0);
  });
  for(const raw of ['[]','null','{}','[1]','["one",null]','[" "]','not json']) test(`${scope}: invalid selection ${raw} cannot delete`,async()=>{
    const f=await fixture(scope);
    assert.equal((await f.submit(raw)).status,400);
    assert.equal(f.mutations.length,0);
    assert.equal(f.invalidations.length,0);
    assert.equal(f.rows.length,5);
  });
  test(`${scope}: failed database deletion cannot report success or invalidate`,async()=>{
    const f=await fixture(scope,true);
    await assert.rejects(f.submit('["one"]'),/DB unavailable/);
    assert.equal(f.rows.length,5); assert.equal(f.invalidations.length,0);
  });
}
