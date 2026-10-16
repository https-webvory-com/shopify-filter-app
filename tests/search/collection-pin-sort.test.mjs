import test from 'node:test';
import assert from 'node:assert/strict';
import * as ordering from '../../app/utils/pinImportOrder.js';
import * as report from '../../app/utils/csvImportReport.js';
import { loadModule } from './helpers/search-ranking.mjs';
const { collectionPinSortKey: key, withCollectionPinSortKeys: enrich, sortPinningRules: sort } = ordering;

test('collection keys reproduce SoBooster serialized ID text, multi-target order and empty scope', () => {
  assert.equal(key([]), '');
  assert.equal(key([10199367708, 'gid://shopify/Collection/277502951485']), '[10199367708,277502951485]');
  assert.equal(key(['277502951485','10199367708']), '[277502951485,10199367708]');
  for (const ids of [null, {}, ['bad'], [null], [0], ['gid://shopify/Product/1'], [1.5]]) assert.equal(key(ids), null);
  const rows = [
    { id: 'small-number', collectionSortKey: '[9202630684]' },
    { id: 'multi', collectionSortKey: '[12359368732,277502951485]' },
    { id: 'military', collectionSortKey: '[10199367708]' },
    { id: 'all', applyToAll: true },
    { id: 'big-number', collectionSortKey: '[132643192893]' },
    { id: 'unknown' },
  ].map(r => ({ ...r, products: [{ id: 'second' }, { id: 'first' }] }));
  assert.deepEqual(sort(rows, 'collection-asc').map(r=>r.id), ['all','military','multi','big-number','small-number','unknown']);
  assert.deepEqual(sort(rows, 'collection-desc').map(r=>r.id), ['small-number','big-number','multi','military','all','unknown']);
  assert.deepEqual(rows[0].products.map(p=>p.id), ['second','first']);
  assert.equal(rows[0].id, 'small-number');
});

test('source tie positions are preserved and unresolved ties remain deterministic', () => {
  const rows = [
    {id:'csv-only',collectionSortPosition:null,createdAt:3},
    {id:'source-second',collectionSortPosition:9,createdAt:2},
    {id:'source-first',collectionSortPosition:8,createdAt:1},
  ].map(r=>({...r,collectionSortKey:'[175215559]'}));
  for(const input of [rows,rows.slice().reverse(),[rows[1],rows[0],rows[2]]]) {
    assert.deepEqual(sort(input,'collection-asc').map(r=>r.id),['source-first','source-second','csv-only']);
  }
  assert.deepEqual(sort(rows,'recent').map(r=>r.id),['csv-only','source-second','source-first']);
});

test('legacy metadata resolves every scoped title without guessing missing or ambiguous collections', () => {
  const rules = [{id:'all',applyToAll:true},{id:'old',collections:['Renamed']},{id:'ambiguous',collections:['Same']},{id:'missing',collections:['Gone']},{id:'partial',collections:['Renamed','Gone']},{id:'source',collections:['Renamed'],collectionSortKey:'[11,22]'}];
  const result=enrich(rules,[{id:'gid://shopify/Collection/9',title:'Renamed'},{id:'gid://shopify/Collection/1',title:'Same'},{id:'gid://shopify/Collection/2',title:'Same'}]);
  assert.deepEqual(result.map(r=>r.collectionSortKey),['','[9]',null,null,null,'[11,22]']);
  assert.equal(rules[1].collectionSortKey,undefined);
});

test('real collection import saves original ID key through renames and partial target matches; legacy updates preserve it', async () => {
  const saved=new Map();
  const prisma={product:{findMany:async()=>[{id:'gid://shopify/Product/1',images:[]},{id:'gid://shopify/Product/2',images:[]}]},
    collection:{findMany:async()=>[{id:'gid://shopify/Collection/99',title:'Current title'}]},
    pinnedProductRule:{upsert:async({where,create,update})=>{const name=where.shop_name_ruleType.name;saved.set(name,saved.has(name)?{...saved.get(name),...update}:create);}},
  };
  const {action}=await loadModule('app/routes/api.import-pins-batch.jsx',{
    '../utils/pinImportOrder.js':ordering,'../utils/csvImportReport.js':report,
    '../shopify.server':{authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})}},
    '../db.server':{default:prisma},'../services/shopCache.server.js':{invalidateShop:async()=>{}},
  });
  const send=async(rows,ruleType='collection')=>(await action({request:new Request('https://fixture/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows,ruleType})})})).json();
  const row={collectionTitles:['Old title'],collectionIds:['11','99'],products:[{Id:'2'},{Id:'1'}]};
  assert.equal((await send([row])).imported,1);
  const rule=saved.get('Old title');assert.equal(rule.collectionSortKey,'[11,99]');
  assert.deepEqual(Array.from(rule.collections),['Current title']);
  assert.deepEqual(Array.from(rule.products,p=>p.id),['gid://shopify/Product/2','gid://shopify/Product/1']);
  await send([{...row,collectionIds:[]}]);assert.equal(saved.get('Old title').collectionSortKey,'[11,99]');
  const result=await send([{...row,collectionIds:['bad']}]);assert.equal(result.skipped,1);
  await send([{products:[{Id:'1'}]}]);assert.equal(saved.get('All Collections').collectionSortKey,'');
  await send([{searchQuery:'dress',products:[{Id:'1'}]}],'search');assert.equal(saved.get('dress').collectionSortKey,undefined);
});
