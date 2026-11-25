import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {collectionPriceCandidateIds} from '../../app/utils/collectionPriceCandidates.js';
const source=await fs.readFile('app/routes/api.filter.jsx','utf8');
const block=source.slice(source.indexOf('    const priceScope='),source.indexOf('    for(const [index,range] of priceCountRanges.entries())'));
async function run({read,search=false,categories,banded}={}){
 const calls={candidates:[],eligibility:[],keys:[],banded:[]},prices={'1':50,'2':110,'3':180,'4':240};
 const filters=categories||{option_Color:'option_Color IN ["Blue"]',option_Size:'option_Size IN ["M"]',tags:'tags IN ["Length_Maxi"]',priceMin:'selected price IDs'};
 const context={resolvedCollectionId:'gid://shopify/Collection/7',isSearch:search,searchQuery:'',activeCategories:Object.keys(filters),categoryFilters:filters,baseFilters:['shop = "fixture.myshopify.com"',"status = 'ACTIVE'"],intentFilters:[],
  hideUnavailable:true,variantPriceV2:false,canonicalVariantPrice:true,
  priceCountRanges:[{min:0,max:99},{min:99,max:159},{min:159,max:199},{min:199,max:Infinity}],variantEligibilityPriceContext:{country:'US',currency:'USD',ranges:[{min:99,max:159}]},priceSortRate:1,optionsFilters:{Color:['Blue'],Size:['M']},mergedValues:[],shop:'fixture.myshopify.com',prisma:{product:{}},searchVariantContext:{},
  convertedPriceBound:value=>value,collectionPriceCandidateIds,
  meiliClient:{index:()=>({getDocuments:async options=>{calls.candidates.push(options);return read?read(options):{results:[{id:'2'},{id:'3'}],total:2};}})},
  getCached:async(key,fn)=>{calls.keys.push(key);return fn();},
  availableProductIdsByPriceRanges:async(_db,where,_options,_merges,ranges)=>{calls.banded.push({where,ranges});return banded?banded(where,ranges,prices):null;},
  availableProductIds:async(_model,where,_options,_merges,range)=>{calls.eligibility.push({where,range});return Object.entries(prices).filter(([id,price])=>(!where.id||where.id.in.includes('gid://shopify/Product/'+id))&&price>=range.min&&price<=range.max).map(([id])=>id);},
 };
 context.facetBaseFilters=context.baseFilters;
 vm.runInNewContext(`async function run(){${block};return priceEligibleIds;}this.run=run;`,context);
 return {calls,ids:JSON.parse(JSON.stringify(await context.run()))};
}
test('all price-list ranges share one complete candidate read with the selected price category removed',async()=>{
 const {calls,ids}=await run();assert.equal(calls.candidates.length,1);assert.equal(calls.eligibility.length,4);
 assert.equal(calls.candidates[0].filter.includes('selected price IDs'),false);assert.ok(calls.candidates[0].filter.includes('tags IN ["Length_Maxi"]'));
 for(const call of calls.eligibility){assert.equal(call.where.shop,'fixture.myshopify.com');assert.equal(call.where.collections.some.collectionId,'gid://shopify/Collection/7');assert.deepEqual(JSON.parse(JSON.stringify(call.where.id.in)),['gid://shopify/Product/2','gid://shopify/Product/3']);}
 assert.deepEqual(ids,[[],['2'],['3'],[]]);
});
test('unavailable or incomplete candidates keep the original full-scoped range checks',async()=>{
 for(const read of [async()=>{throw Error('Unavailable');},async()=>({results:[{id:'2'},{id:'2'}],total:2})]){
  const {calls,ids}=await run({read});assert.equal(calls.candidates.length,1);assert.equal(calls.eligibility.length,4);assert.ok(calls.eligibility.every(call=>!call.where.id));assert.deepEqual(ids,[['1'],['2'],['3'],['4']]);
 }
});
test('complete empty candidates avoid all four database reads',async()=>{
 const {calls,ids}=await run({read:async()=>({results:[],total:0})});assert.equal(calls.eligibility.length,0);assert.deepEqual(ids,[[],[],[],[]]);
});
test('search and price-only selections retain the established full-scope count path',async()=>{
 for(const options of [{search:true},{categories:{priceMin:'price'}}]){
  const {calls}=await run(options);assert.equal(calls.candidates.length,0);assert.ok(calls.eligibility.every(call=>!call.where.id));
 }
});
test('a single selected filter already narrows price-band counts to its complete indexed candidates',async()=>{
 const {calls,ids}=await run({categories:{option_Color:'option_Color IN ["Blue"]',priceMin:'selected price IDs'}});
 assert.equal(calls.candidates.length,1);assert.ok(calls.candidates[0].filter.includes('option_Color IN ["Blue"]'));
 assert.equal(calls.candidates[0].filter.includes('selected price IDs'),false);
 for(const call of calls.eligibility)assert.deepEqual(JSON.parse(JSON.stringify(call.where.id.in)),['gid://shopify/Product/2','gid://shopify/Product/3']);
 assert.deepEqual(ids,[[],['2'],['3'],[]]);
});
test('every band is decided in one database pass when the exact path is available',async()=>{
 const {calls,ids}=await run({banded:(where,ranges,prices)=>ranges.map(range=>Object.entries(prices).filter(([id,price])=>where.id.in.includes('gid://shopify/Product/'+id)&&price>=range.min&&price<=range.max).map(([id])=>id))});
 assert.equal(calls.banded.length,1);assert.equal(calls.eligibility.length,0);assert.equal(calls.candidates.length,1);
 assert.equal(calls.banded[0].where.shop,'fixture.myshopify.com');assert.equal(calls.banded[0].ranges.length,4);
 assert.deepEqual(ids,[[],['2'],['3'],[]]);
});
