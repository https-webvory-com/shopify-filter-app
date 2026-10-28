import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {SEARCH_FILTER_FIELDS} from '../../app/utils/searchIndexProjection.js';

async function prepare({apply=false,searchable=['title','vendor'],taskStatus='succeeded'}={}){
 const writes=[],waited=[];
 const index={
  getSettings:async()=>({filterableAttributes:['id','shop','status','title','createdAt',...SEARCH_FILTER_FIELDS],searchableAttributes:searchable}),
  updateSearchableAttributes:async fields=>{writes.push(fields);return {taskUid:42};},
  search:async()=>({totalHits:0}),
 };
 const process={argv:apply?['--apply']:[],exitCode:0};
 const client={index:()=>index,tasks:{waitForTask:async id=>{waited.push(id);return {status:taskStatus};}}};
 const source=(await readFile('scripts/prepare-search-page-index.mjs','utf8')).replace(/^import .*;\r?\n/gm,'');
 const context=vm.createContext({client,SEARCH_FILTER_FIELDS,SEARCH_PROJECTION_VERSION:1,process,console:{log(){}}});
 await vm.runInContext('(async()=>{'+source+'})()',context);
 return {writes,waited,process};
}

test('SKU settings check is read-only until explicitly applied',async()=>{
 const r=await prepare();assert.equal(r.process.exitCode,1);assert.equal(r.writes.length,0);
});
test('SKU activation preserves searchable fields and waits for index completion without product sync',async()=>{
 const r=await prepare({apply:true});
 assert.deepEqual(Array.from(r.writes[0]),['title','vendor','variantPrices.sku']);
 assert.deepEqual(r.waited,[42]);assert.equal(r.process.exitCode,0);
});
test('SKU activation is idempotent and respects existing wildcard or parent fields',async()=>{
 for(const searchable of [['*'],['title','variantPrices'],['title','variantPrices.sku']]){
  const r=await prepare({apply:true,searchable});assert.equal(r.writes.length,0);
 }
});
test('failed SKU indexing cannot report successful activation',async()=>{
 await assert.rejects(prepare({apply:true,taskStatus:'failed'}),/SKU search preparation failed/);
});
