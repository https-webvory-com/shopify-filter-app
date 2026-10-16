import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedPinImportRows,parsePinImportOrder,sortPinningRules} from '../../app/utils/pinImportOrder.js';
import * as ordering from '../../app/utils/pinImportOrder.js';
import * as helpers from '../../app/utils/csvImportReport.js';
import {loadModule} from './helpers/search-ranking.mjs';
const group='1792129204954:12345678-1234-4234-9234-123456789abc';
const row=(i)=>({externalId:String(i),sourceRow:i+2,collectionTitles:['Collection '+i],searchQuery:'query '+i,products:[{Id:'2'},{Id:'1'}]});

for(const scope of ['collection','search'])test(`${scope}: 151 imported rules retain CSV order across batches, reverse completion, re-import, exclusions and edits`,async()=>{
  const saved=new Map(),warnings=[];
  let tick=0;
  const prisma={
    product:{findMany:async()=>[{id:'gid://shopify/Product/1',title:'One',images:[]},{id:'gid://shopify/Product/2',title:'Two',images:[]}]},
    collection:{findMany:async({where})=>where.OR[0].title.in.map(title=>({id:title,title}))},
    pinnedProductRule:{upsert:async({where,create,update})=>{
      assert.equal(where.shop_name_ruleType.shop,'fixture.myshopify.com');
      assert.equal(where.shop_name_ruleType.ruleType,scope);
      if(Number(create.importOrder.slice(-10))<52)await new Promise(resolve=>setTimeout(resolve,1));
      const name=where.shop_name_ruleType.name;
      if(saved.has(name))Object.assign(saved.get(name),update);
      else saved.set(name,{id:name,createdAt:new Date(1700000000000+tick++),...create});
    }},
  };
  const {action}=await loadModule('app/routes/api.import-pins-batch.jsx',{
    '../utils/pinImportOrder.js':ordering,'../utils/csvImportReport.js':helpers,
    '../shopify.server':{authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})}},
    '../db.server':{default:prisma},'../services/shopCache.server.js':{invalidateShop:async shop=>warnings.push(shop)},
  });
  const input=Array.from({length:151},(_,i)=>row(i));
  const ordered=orderedPinImportRows(input,group);
  const send=async rows=>{const r=await action({request:new Request('https://fixture/api/import-pins-batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ruleType:scope,rows})})});return r.json();};
  const batches=[ordered.slice(0,50),ordered.slice(50,100),ordered.slice(100,150),ordered.slice(150)];
  const result=await Promise.all(batches.map(send));
  assert.equal(result.reduce((sum,r)=>sum+r.imported,0),151);
  assert.equal(saved.size,151);
  const expected=input.map(r=>scope==='collection'?r.collectionTitles[0]:r.searchQuery);
  assert.deepEqual(sortPinningRules([...saved.values()]).map(r=>r.name),expected);
  assert.ok([...saved.values()].every(r=>r.products.map(p=>p.id).join() === 'gid://shopify/Product/2,gid://shopify/Product/1'),'product order is untouched');
  // Re-import the same names in the opposite order, keeping original creation dates.
  const reversed=orderedPinImportRows([...input].reverse().map((r,i)=>({...r,sourceRow:i+2})),group.replace('4954','5954'));
  const dates=[...saved.values()].map(r=>r.createdAt.toISOString());
  await send(reversed);
  assert.equal(saved.size,151);
  assert.deepEqual(sortPinningRules([...saved.values()]).map(r=>r.name),expected.slice().reverse());
  assert.deepEqual([...saved.values()].map(r=>r.createdAt.toISOString()),dates,'does not fake creation dates');
  const list=[...saved.values()];list[0].status=false;list[1].name='Renamed';
  const subset=list.filter(r=>r.status!==false);
  assert.deepEqual(sortPinningRules(subset).map(r=>r.id),sortPinningRules(list).filter(r=>r.status!==false).map(r=>r.id));
  const invalid=await send([{...row(0),importOrder:'bad'}]);
  assert.equal(invalid.skipped,1);assert.match(invalid.errors[0].reason,/order.*invalid/);
  const before=saved.values().next().value.importOrder;
  await send([input[0]]);
  assert.equal(saved.values().next().value.importOrder,before,'legacy requests do not erase saved ordering');
});

test('default ordering keeps imports grouped, CSV gaps, manual rules and explicit date sorting',()=>{
 const imported=orderedPinImportRows([{id:'first',sourceRow:2},{id:'later',sourceRow:9}],group).map((r,i)=>({...r,createdAt:new Date(1700000000000+i)}));
 const older={id:'older',createdAt:new Date(1600000000000)};
 const newer={id:'newer',createdAt:new Date(1800000000000)};
 const sameMillisecond=orderedPinImportRows([{id:'other'}],group.replace('12345678','ffffffff')).map(r=>({...r,createdAt:new Date(1700000000000)}));
 const rows=[older,imported[1],newer,sameMillisecond[0],imported[0]];
 assert.deepEqual(sortPinningRules(rows).map(r=>r.id),['newer','other','first','later','older']);
 assert.deepEqual(sortPinningRules(rows,'recent').map(r=>r.id),['newer','later','other','first','older']);
 assert.equal(sortPinningRules(rows,'oldest')[0].id,'older');
 assert.equal(rows[0].id,'older','sorting does not mutate loader data');
 for(const value of [null,'',{},'bad',group+':0000000000',group+':0000000001'])assert.equal(parsePinImportOrder(value),null);
 assert.equal(parsePinImportOrder(imported[1].importOrder).position,9);
 assert.ok(orderedPinImportRows([{}])[0].importOrder,'creates one native random group for an upload');
});
