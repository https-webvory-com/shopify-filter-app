import test from 'node:test';
import assert from 'node:assert/strict';
import {availableProductIds,matchingAvailableVariants} from '../../app/utils/availableVariants.js';

test('availability with no option selection reads IDs only and keeps all cursor pages',async()=>{
 const rows=Array.from({length:1003},(_,i)=>({id:`gid://shopify/Product/${i+1}`}));
 const calls=[];
 const model={findMany:async query=>{
  calls.push(query);assert.deepEqual(query.select,{id:true});
  assert.deepEqual(query.where,{shop:'fixture',status:'active',variants:{some:{available:true}}});
  const offset=query.cursor?rows.findIndex(p=>p.id===query.cursor.id)+query.skip:0;
  return rows.slice(offset,offset+query.take);
 }};
 const ids=await availableProductIds(model,{shop:'fixture',status:'active'},{Color:[]},[]);
 assert.equal(ids.length,1003);assert.equal(new Set(ids).size,1003);
 assert.equal(calls.length,2);assert.equal(ids.at(-1),'1003');
});

test('database prefilter preserves merged values, swapped positions, whitespace and same-variant matching',async()=>{
 const filters={Color:['Blue'],Size:['L']};
 const merged=[{optionName:'color',targetValue:'BLUE',sourceValues:['Navy']}];
 const products=[
  {id:'1',options:[{name:'Size'},{name:'Color'}],variants:[{available:true,option1:'l',option2:' Navy '}]},
  {id:'2',options:[{name:'Color'},{name:'Size'}],variants:[{available:true,option1:'Light Blue',option2:'L'}]},
  {id:'3',options:[{name:'Color'},{name:'Size'}],variants:[{available:true,option1:'Blue',option2:'S'},{available:true,option1:'Black',option2:'L'}]},
  {id:'4',options:[{name:'Color'},{name:'Size'}],variants:[{available:false,option1:'Blue',option2:'L'}]},
  {id:'5',options:[{name:'Color'},{name:'Size'}],variants:[{available:true,option1:'bLuE',option2:'L'}]},
 ];
 let transferred=0;
 const matches=(v,where)=>v.available===where.available&&where.AND.every(group=>group.OR.some(condition=>{
  const [field,match]=Object.entries(condition)[0];return match===null?v[field]==null:v[field]!=null&&String(v[field]).toLowerCase().includes(match.contains);
 }));
 const model={findMany:async query=>{
  assert.equal(query.where.shop,'fixture');assert.equal(query.where.collections.some.collectionId,'collection');
  assert.deepEqual(query.where.variants.some,query.select.variants.where);
  assert.ok(query.where.variants.some.AND[0].OR.some(c=>c.option2?.contains==='navy'));
  return products.map(p=>({...p,variants:p.variants.filter(v=>matches(v,query.where.variants.some))})).filter(p=>p.variants.length).map(p=>{transferred+=p.variants.length;return p;});
 }};
 const expected=products.filter(p=>matchingAvailableVariants(p,filters,merged).length).map(p=>p.id);
 assert.deepEqual(await availableProductIds(model,{shop:'fixture',collections:{some:{collectionId:'collection'}}},filters,merged),expected);
 assert.deepEqual(expected,['1','5']);assert.equal(transferred,4);
});
