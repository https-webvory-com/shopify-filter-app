import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {collectionPriceCandidateIds} from '../../app/utils/collectionPriceCandidates.js';

const source=await fs.readFile('app/routes/api.filter.jsx','utf8');
const block=source.slice(source.indexOf('    if((canonicalVariantPrice&&!variantPriceV2)'),source.indexOf('    const allFiltersList'));
const shop='fixture.myshopify.com',collectionId='gid://shopify/Collection/7';
async function check({fastCards=true,isSearch=false,categories,read}={}){
  const calls={candidates:[],eligibility:[],cache:[]};
  const categoryFilters=categories||{vendor:'vendor IN ["Designer"]',tags:'tags IN ["Length_Maxi"]',option_Color:'option_Color IN ["Blue"]',option_Size:'option_Size IN ["M"]'};
  const context={canonicalVariantPrice:true,variantPriceV2:false,fastCards,isSearch,searchQuery:'',resolvedCollectionId:collectionId,
    nativeRanges:[{min:99,max:159}],variantEligibilityPriceContext:{country:'US',currency:'USD',stockOnly:true},
    categoryFilters,baseFilters:[`shop = '${shop}'`,"status = 'ACTIVE'",`collections = '${collectionId}'`],intentFilters:[],
    cancelled:()=>false,
    shop,optionsFilters:{Color:['Blue'],Size:['M']},mergedValues:[],prisma:{product:{}},eligibilityStarted:Date.now(),variantEligibilityMs:0,
    meiliClient:{index:()=>({getDocuments:async options=>{calls.candidates.push(options);return read?read(options):{results:[{id:'2'},{id:'3'}],total:2};}})},
    collectionPriceCandidateIds,
    getCached:async(key,fn)=>{calls.cache.push(key);return fn();},
    availableProductIds:async(_model,where,filters,merged,range,{priceContext})=>{
      calls.eligibility.push({where,filters,merged,range,priceContext});
      return where.id?.in.map(id=>id.split('/').pop())||['1','2','3','4'];
    },
  };
  vm.runInNewContext(`async function run(){${block};return categoryFilters;}this.run=run;`,context);
  const result=await context.run();return {calls,result};
}

test('four-filter card reads restrict variant work to complete indexed candidates and preserve all original SQL constraints',async()=>{
  const {calls,result}=await check();assert.equal(calls.candidates.length,1);assert.equal(calls.eligibility.length,1);
  assert.deepEqual(calls.candidates[0].fields,['id']);
  assert.ok(calls.candidates[0].filter.includes('vendor IN ["Designer"]'));
  assert.ok(calls.candidates[0].filter.includes('tags IN ["Length_Maxi"]'));
  const eligibility=calls.eligibility[0];assert.equal(eligibility.where.shop,shop);
  assert.equal(eligibility.where.collections.some.collectionId,collectionId);
  assert.deepEqual(JSON.parse(JSON.stringify(eligibility.where.id.in)),['gid://shopify/Product/2','gid://shopify/Product/3']);
  assert.equal(eligibility.filters.Color[0],'Blue');assert.equal(eligibility.filters.Size[0],'M');
  assert.equal(eligibility.range.min,99);assert.equal(eligibility.range.max,159);assert.equal(eligibility.priceContext.stockOnly,true);
  assert.equal(result.priceMin,'id IN ["2","3"]');
});

test('canonical facets retain the full scope so narrowing cards cannot suppress disjunctive choices',async()=>{
  const {calls,result}=await check({fastCards:false});assert.equal(calls.candidates.length,0);
  assert.equal(calls.eligibility[0].where.id,undefined);assert.equal(result.priceMin,'id IN ["1","2","3","4"]');
});

test('incomplete candidate pages and failures fall back to the original exact full-collection check',async()=>{
  for(const read of [async()=>{throw Error('Index unavailable');},async()=>({results:[{id:'2'},{id:'2'}],total:2}),async()=>({results:[],total:2})]){
    const {calls,result}=await check({read});assert.equal(calls.eligibility.length,1);
    assert.equal(calls.eligibility[0].where.id,undefined);assert.equal(result.priceMin,'id IN ["1","2","3","4"]');
  }
});

test('a complete empty candidate set needs no database variant scan',async()=>{
  const {calls,result}=await check({read:async()=>({results:[],total:0})});
  assert.equal(calls.eligibility.length,0);assert.equal(result.priceMin,'id = "__no_eligible_price_variant__"');
});

test('candidate reads include every capped page, rather than treating the first page as all matching products',async()=>{
  const {calls}=await check({read:async({offset})=>({results:offset?[{id:'3'}]:[{id:'2'}],total:2})});
  assert.equal(calls.candidates.length,2);assert.equal(calls.eligibility[0].where.id.in.length,2);
});

test('single-category requests and submitted search keep their existing eligibility path',async()=>{
  for(const options of [{categories:{option_Color:'option_Color IN ["Blue"]'}},{isSearch:true}]){
    const {calls}=await check(options);assert.equal(calls.candidates.length,0);assert.equal(calls.eligibility[0].where.id,undefined);
  }
});

test('candidate-dependent eligibility cache entries cannot be reused across different product filters',async()=>{
  const first=await check(),second=await check({categories:{vendor:'vendor IN ["Other"]',option_Color:'option_Color IN ["Blue"]',option_Size:'option_Size IN ["M"]'}});
  assert.notEqual(first.calls.cache[0],second.calls.cache[0]);
});
