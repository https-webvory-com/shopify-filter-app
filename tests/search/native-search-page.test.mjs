import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSearchPagePlan } from '../../app/utils/searchPagePlan.js';
import { searchIndexProjection, SEARCH_FILTER_FIELDS, searchExactToken, decodeSearchFacet } from '../../app/utils/searchIndexProjection.js';
import { loadModule } from './helpers/search-ranking.mjs';
import * as colors from '../../app/utils/searchColor.js';

test('search projections preserve inventory, discount, SKU, available color and whole-phrase option matching', () => {
  const p = searchIndexProjection({ priceMin: 10, inventoryTotal: -3, options: [{name:'Size'}, {name:'Colour'}],
    variantPrices: [{ option1:'S', option2:'Black / Gold', available:false, sku:' SKU-1 ', price:10, compareAtPrice:20 },
      { option1:'L', option2:'Red', available:true, sku:'SKU-2', price:30 }] });
  assert.equal(p.cfpSearchVersion, 1); assert.equal(p.cfpSearchInventory, -3);
  assert.equal(p.cfpSearchDiscount, 10); assert.equal(p.cfpSearchPercentSales, 50);
  assert.deepEqual(p.cfpSearchColors, ['black / gold', 'red'].map(searchExactToken)); assert.deepEqual(p.cfpSearchAvailableColors, ['red'].map(searchExactToken));
  assert.deepEqual(p.cfpSearchSkus, ['sku-1', 'sku-2'].map(searchExactToken));
  assert.ok(p.cfpSearchOptionPhrases.includes(searchExactToken('black / gold'))); assert.ok(p.cfpSearchOptionPhrases.includes(searchExactToken('gold')));
  assert.ok(!p.cfpSearchOptionPhrases.includes(searchExactToken('black gold')));
});

test('unbounded option text refuses native readiness rather than growing the index without bound', () => {
  const p = searchIndexProjection({ variantPrices:[{option1:'a'.repeat(129)}] });
  assert.equal(p.cfpSearchVersion, 0);
});

test('exact predicates and encoded facets retain whitespace, casing and unsupported large metafields', () => {
  const p=searchIndexProjection({vendor:' VIP ',tags:['Sale','sale'],priceMin:0,
    'metafield_custom.long':'x'.repeat(4097)});
  assert.notEqual(p.cfpSearchVendor,searchExactToken('vip'));
  const facets=p.cfpSearchFacetValues.map(decodeSearchFacet);
  assert.ok(facets.some(([k,v])=>k==='vendor'&&v===' VIP '));
  assert.equal(facets.filter(([k])=>k==='tags').length,2);
  assert.deepEqual(p.cfpSearchFacetUnsupported,['metafield_custom.long']);
  assert.equal(p.cfpSearchVersion,1,'large unused facets must not disable instant product search');
});

test('merchandising plans preserve positional weights, Pin priority and Dynamic arithmetic', () => {
  const plan = compileSearchPagePlan({ conditions:[
    {action:'Boost',field:'Tags',value:'featured'}, {action:'Pin',field:'Vendor',value:'VIP'},
    {action:'Dynamic',field:'Price',minValue:0,maxValue:100,operator:'Set',operand:'-10'},
  ] });
  assert.ok(plan); assert.equal(plan.tiers[0].pinned, true);
  assert.ok(plan.tiers.some(t => t.pinned && t.score === -10));
  assert.ok(plan.tiers.some(t => !t.pinned && t.score === 2000000));
  assert.ok(plan.tiers.some(t => t.filter[0].includes('cfpSearchPrice')));
});

test('native plans retain exclusions under sort priority, merged options, escaping and malformed ranges', () => {
  const p = compileSearchPagePlan({conditions:[{action:'Exclude',field:'Available',maxValue:'0'},
    {action:'Boost',field:'Color (product option)',value:'Blue'}]}, 'price-ascending', {prioritizeSortOverMerchandising:true},
    [{targetValue:'Blue',sourceValues:['Navy']}]);
  assert.equal(p.tiers.length, 1); assert.deepEqual(p.sort, ['priceMin:asc']);
  assert.match(p.tiers[0].filter[0], /NOT.*cfpSearchInventory/);
  const aliases = compileSearchPagePlan({conditions:[{action:'Boost',field:'Color (product option)',value:'Blue'}]}, 'relevance', {},
    [{targetValue:'Blue',sourceValues:['Navy']}]);
  assert.ok(aliases.tiers[0].filter[0].includes(searchExactToken('navy')));
  assert.ok(compileSearchPagePlan({conditions:[{action:'Exclude',field:'Price',minValue:'Infinity'}]}).tiers[0].filter[0].includes('NOT shop EXISTS'));
});

test('unsupported arithmetic order, unknown fields and excessive rule combinations keep the compatibility path', () => {
  assert.equal(compileSearchPagePlan({conditions:[{action:'Boost',field:'Tags',value:'x'}]}, 'best-selling'), null);
  assert.equal(compileSearchPagePlan({conditions:[{action:'Exclude',field:'Unknown',value:'x'}]}), null);
  assert.equal(compileSearchPagePlan({conditions:Array.from({length:6},()=>({action:'Boost',field:'Tags',value:'x'}))}), null);
});

async function nativeFixture({ filterable = ['id','shop','status',...SEARCH_FILTER_FIELDS], ready = true, batch } = {}) {
  const requests = [];
  const service = await loadModule('app/services/nativeSearchPage.server.js', {
    './meiliClient.server': {default:{index:()=>({getSettings:async()=>({filterableAttributes:filterable,pagination:{maxTotalHits:100000}}),
      search:async(_q,params)=>{requests.push(params);return {totalHits:ready?0:1};}})}},
    '../db.server':{default:{}}, './shopCache.server':{getCached:async(_k,read)=>read()},
    './semanticSearch.server':{searchPageBatch:batch || (()=>{throw Error('unexpected native query');})},
    '../utils/searchPagePlan.js':{compileSearchPagePlan},
    '../utils/searchIndexProjection.js':{SEARCH_FILTER_FIELDS,SEARCH_PROJECTION_VERSION:1,searchExactToken,decodeSearchFacet},
    './merchandising.server':{buildMeiliIncludeFilters:()=>[],applyMerchandisingRules:p=>p,selectMerchandisingVariant:()=>null},
    '../utils/searchColor.js':colors,
  });
  return {service,requests,spec:{shop:'fixture.myshopify.com',query:'red dress',options:{filter:["shop = 'fixture.myshopify.com'","status = 'ACTIVE'"]},limit:6}};
}

test('missing deployed ID filtering or projection readiness never issues unsupported page filters', async () => {
  const missing = await nativeFixture({filterable:['shop']});
  assert.equal(await missing.service.rankNativeSearchPage(missing.spec), null); assert.equal(missing.requests.length,0);
  const notReady = await nativeFixture({ready:false});
  assert.equal(await notReady.service.rankNativeSearchPage(notReady.spec), null);
});

test('a 50,000-result search returns only six documents with engine counts and facets', async () => {
  const calls=[];
  const f=await nativeFixture({batch:async(queries,mode)=>{
    calls.push({queries,mode});
    if(queries[0].hitsPerPage===1)return {semantic:true,results:[{totalHits:50000,facetDistribution:{cfpSearchFacetValues:{[searchExactToken(JSON.stringify(['tags','red']))]:50000}}}]};
    assert.equal(queries[0].limit,6);assert.equal(queries[0].offset,0);
    return {semantic:true,results:[{hits:Array.from({length:6},(_,i)=>({id:String(i+1),title:'Red dress'}))}]};
  }});
  const r=await f.service.rankNativeSearchPage({...f.spec,facetKeys:['tags','priceMin']});
  assert.equal(r.total,50000);assert.equal(r.products.length,6);assert.equal(r.rankingMode,'native');assert.equal(calls.length,2);
  assert.equal(calls[1].mode,true);assert.equal(r.facetDistribution.tags.red,50000);
  const preview=await f.service.rankNativeSearchPage({...f.spec,facetKeys:[]});
  assert.deepEqual(preview.products.map(p=>p.id),r.products.map(p=>p.id));
  assert.equal(preview.total,r.total);
  assert.equal(Object.keys(preview.facetDistribution).length,0);
  assert.equal(calls[2].queries[0].facets,undefined,'early cards must skip facet aggregation');
});

test('embedding failure between count and page restarts both stages as keyword search', async () => {
  const modes=[];
  const f=await nativeFixture({batch:async(queries,mode)=>{
    modes.push(mode);
    if(queries[0].hitsPerPage===1)return {semantic:mode!==false,results:[{totalHits:mode===false?1:50000}]};
    if(mode===true)throw Error('provider unavailable');
    return {semantic:false,results:[{hits:[{id:'keyword'}]}]};
  }});
  const r=await f.service.rankNativeSearchPage(f.spec);
  assert.equal(r.total,1);assert.equal(r.products[0].id,'gid://shopify/Product/keyword');
  assert.deepEqual(modes,[undefined,true,false,false]);assert.equal(r.semanticHitCount,0);
});
