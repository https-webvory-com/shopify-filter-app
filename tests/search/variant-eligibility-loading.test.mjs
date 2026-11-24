import test from 'node:test';
import assert from 'node:assert/strict';
import {availableProductIds,matchingAvailableVariants} from '../../app/utils/availableVariants.js';

test('search color intent and selected size restrict the same available variant, without broad alias expansion',async()=>{
 const options=[{name:'Size'},{name:'Colour'}];
 const variant=(size,color,available=true)=>({option1:size,option2:color,available});
 const products=[
  {id:'1',options,variants:[variant('M',' Red ')]},
  {id:'2',options,variants:[variant('M','Blue'),variant('L','Red')]},
  {id:'3',options,variants:[variant('M','Blue'),variant('M','Red',false)]},
  {id:'4',options,variants:[variant('M','Pink')]},
 ];
 const aliases=[{optionName:'Colour',targetValue:'Red',sourceValues:['Pink']}];
 const context={searchColorValues:['Red']};
 const baseline=products.filter(p=>matchingAvailableVariants(p,{},aliases,null,context).length).map(p=>p.id);
 const filtered=products.filter(p=>matchingAvailableVariants(p,{Size:['M']},aliases,null,context).length).map(p=>p.id);
 assert.deepEqual(baseline,['1','2']);assert.deepEqual(filtered,['1']);
 assert.ok(filtered.every(id=>baseline.includes(id)));
 const model={findMany:async query=>{
  assert.equal(query.where.shop,'fixture');assert.equal(query.where.variants.some.available,true);
  assert.equal(query.where.variants.some.AND.length,2,'query color uses the same prefiltered variants as size');
  return products;
 }};
 assert.deepEqual(await availableProductIds(model,{shop:'fixture'},{Size:['M']},aliases,null,{priceContext:context}),['1']);
 assert.deepEqual(await availableProductIds(model,{shop:'fixture'},{Size:['M']},aliases,null,{database:{$queryRaw:async()=>{throw Error('fallback');}},priceContext:context}),['1']);
});

test('search intent adds one bound same-variant predicate; collection reads do not inherit query colors',async()=>{
 const queries=[];
 const database={$queryRaw:async query=>{queries.push(query);return [{id:'gid://shopify/Product/1'}];}};
 const model={findMany:()=>{throw Error('Must not hydrate candidate variants');}};
 const where={shop:'fixture',status:{equals:'active',mode:'insensitive'},collections:{some:{collectionId:'collection'}}};
 const filters={Size:['M']};
 const context={searchColorValues:["Red' OR 1=1 --"]};
 assert.deepEqual(await availableProductIds(model,where,filters,[],null,{database,priceContext:context}),['1']);
 assert.equal(queries.length,1);
 assert.ok(queries[0].values.includes('color'));assert.ok(queries[0].values.includes('colour'));
 assert.ok(queries[0].text.includes('pc."collectionId"'));
 assert.ok(queries[0].text.includes('v."available" = true'));
 assert.ok(queries[0].values.includes(context.searchColorValues[0].toLowerCase()));
 assert.ok(!queries[0].text.includes(context.searchColorValues[0]));
 await availableProductIds(model,where,filters,[],null,{database});
 assert.equal(queries.length,2);
 assert.equal(queries[1].values.includes('colour'),false,'collection path has no additional query-color predicate or query');
 assert.deepEqual(await availableProductIds(model,where,filters,[],null,{database,priceContext:{searchColorValues:[]}}),[]);
 assert.equal(queries.length,2,'unknown query color returns empty without another database call');
});

test('eligibility resolves option positions once per scoped product while retaining same-variant predicates',async()=>{
 let query;
 const database={$queryRaw:async value=>{query=value;return [{id:'gid://shopify/Product/1'}];}};
 const where={shop:'fixture',status:{equals:'active',mode:'insensitive'},id:{in:['gid://shopify/Product/1']},collections:{some:{collectionId:'collection'}}};
 assert.deepEqual(await availableProductIds({findMany:()=>{throw Error('Unexpected fallback');}},where,{Color:['Black'],Size:['M']},[],{min:99,max:159},{database}),['1']);
 const variantRead=query.text.indexOf('FROM "Variant" v');
 assert.ok(variantRead>query.text.lastIndexOf('jsonb_array_elements'),'option JSON walks occur before the variant EXISTS read');
 assert.equal(query.text.match(/jsonb_array_elements/g).length,2);
 assert.ok(query.text.includes('AS MATERIALIZED'));
 assert.ok(query.text.includes('v."productId" = p."id"'));assert.ok(query.text.includes('v."available" = true'));
 for(const bound of [99,159,'fixture','collection','black','m'])assert.ok(query.values.includes(bound));
 assert.ok(query.text.includes('IS NULL THEN NULL'),'missing option names cannot match an empty selected value');
});

test('open-ended prices omit the upper bound in SQL and Prisma fallback',async()=>{
 const filters={Color:['Burgundy']},range={min:10,max:Infinity};
 const product={id:'gid://shopify/Product/1',options:[{name:'Color'}],variants:[{available:true,option1:'Wine',price:20000}]};
 const merged=[{optionName:'Color',targetValue:'Burgundy',sourceValues:['Wine']}];
 const model={findMany:async query=>{
  assert.deepEqual(query.where.variants.some.price,{gte:10});
  assert.deepEqual(query.select.variants.where.price,{gte:10});
  return [product];
 }};
 let queried=false;
 const database={$queryRaw:async query=>{
  queried=true;assert.equal(query.values.includes(Infinity),false);
  assert.equal(query.text.includes('v."price" <='),false);
  assert.ok(query.text.includes('v."price" >='));
  return [{id:product.id}];
 }};
 assert.deepEqual(await availableProductIds(model,{shop:'fixture'},filters,merged,range,{database}),['1']);
 assert.equal(queried,true);
 assert.deepEqual(await availableProductIds(model,{shop:'fixture'},filters,merged,range),['1']);
 assert.deepEqual(await availableProductIds(model,{shop:'fixture'},filters,merged,range,{database:{$queryRaw:async()=>{throw Error('fallback');}}}),['1']);
});

test('the exact database path binds filter values and returns IDs without hydrating variant documents',async()=>{
 const hostile="Black' OR 1=1 --",model={findMany:()=>{throw Error('Variant document transfer is forbidden');}};
 const database={$queryRaw:async query=>{assert.ok(query.values.includes(hostile.toLowerCase()));assert.equal(query.text.includes(hostile),false);assert.ok(query.text.includes('EXISTS'));return [{id:'gid://shopify/Product/1'}];}};
 assert.deepEqual(await availableProductIds(model,{shop:'fixture',status:{equals:'active',mode:'insensitive'}},{Color:[hostile]},[],null,{database}),['1']);
});

test('unavailable exact queries retain the established availability fallback',async()=>{
 let fallback=0;const model={findMany:async()=>{fallback++;return [{id:'1',options:[{name:'Color'}],variants:[{option1:'Black',available:true}]}];}};
 const database={$queryRaw:async()=>{throw Error('Optional query unavailable');}};
 assert.deepEqual(await availableProductIds(model,{shop:'fixture'},{Color:['Black']},[],null,{database}),['1']);assert.equal(fallback,1);
});

test('price and selected options must match the same available variant',async()=>{
 const filters={Color:['Black'],Size:['2XL']};
 const options=[{name:'Color'},{name:'Size'}];
 const variant=(color,price)=>({available:true,option1:color,option2:'2XL',price});
 const products=[
  {id:'1',options,variants:[variant('Red',10),variant('Black',950)]},
  {id:'2',options,variants:[variant('Red',10),variant('Black',{toString:()=> '500.25'})]},
  {id:'3',options,variants:[variant('Black',null)]},
 ];
 const range={min:400,max:817.5};
 assert.deepEqual(products.map(p=>matchingAvailableVariants(p,filters,[],range).length),[0,1,0]);
 const model={findMany:async query=>{
  assert.deepEqual(query.where.variants.some.price,{gte:400,lte:817.5});
  assert.equal(query.select.variants.select.price,true);
  return products;
 }};
 assert.deepEqual(await availableProductIds(model,{shop:'fixture'},filters,[],range),['2']);
});

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
