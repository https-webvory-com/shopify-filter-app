import test from 'node:test';
import assert from 'node:assert/strict';
import {narrowerCollectionFilters,readNarrowerCollectionMembership} from '../../app/utils/collectionFilterMembership.js';

const base='https://example.test/api/filter?shop=fixture.myshopify.com&country=IN&collectionHandle=formal-dresses&sortBy=best-selling&page=1&limit=25';
test('only adding a new filter category can narrow a prepared result',()=>{
 const blue=base+'&options[Color][]=Blue';
 assert.equal(narrowerCollectionFilters(blue,blue+'&options[Size][]=L'),true);
 assert.equal(narrowerCollectionFilters(blue,blue+'&options[Color][]=Red'),false);
 assert.equal(narrowerCollectionFilters(blue+'&options[Size][]=L',blue),false);
 assert.equal(narrowerCollectionFilters(blue,blue.replace('country=IN','country=US')+'&options[Size][]=L'),false);
 assert.equal(narrowerCollectionFilters(base,blue),false);
});

test('a new filter searches only parent IDs and retains their exact order',async()=>{
 const parentIds=Array.from({length:1800},(_,i)=>String(i+1));
 const expected=parentIds.filter(id=>Number(id)%3===0);
 const calls=[];
 const index={getSettings:async()=>({distinctAttribute:null,pagination:{maxTotalHits:10000}}),
  getDocuments:async options=>{
   calls.push(options);
   const scoped=options.filter.find(value=>typeof value==='string'&&value.startsWith('id IN '));
   assert.deepEqual(JSON.parse(scoped.slice(6)),parentIds);
   const rows=expected.map(id=>({id,shop:'fixture.myshopify.com',status:'ACTIVE'})).reverse();
   return {total:rows.length,results:rows.slice(options.offset,options.offset+options.limit)};
  }};
 const actual=await readNarrowerCollectionMembership(index,{filter:['option_Size IN [\'L\']'],parentIds,shop:'fixture.myshopify.com'});
 assert.deepEqual(actual,expected);
 assert.equal(calls.length,1);
});

test('unstable or cross-shop membership falls back to full ranking',async()=>{
 const parentIds=['1','2'];
 for(const invalid of [[{id:'1',shop:'other.myshopify.com',status:'ACTIVE'}],[{id:'1',shop:'fixture.myshopify.com',status:'ACTIVE'},{id:'1',shop:'fixture.myshopify.com',status:'ACTIVE'}]]){
  const index={getSettings:async()=>({pagination:{maxTotalHits:10000}}),getDocuments:async()=>({total:invalid.length,results:invalid})};
  assert.equal(await readNarrowerCollectionMembership(index,{filter:[],parentIds,shop:'fixture.myshopify.com'}),null);
 }
});
