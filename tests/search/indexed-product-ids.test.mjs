import test from 'node:test';
import assert from 'node:assert/strict';
import {readIndexedProductIds} from '../../app/utils/indexedProductIds.js';
import {collectionPriceCandidateIds} from '../../app/utils/collectionPriceCandidates.js';
import {readNarrowerCollectionMembership} from '../../app/utils/collectionFilterMembership.js';

const settings={distinctAttribute:null,displayedAttributes:['*'],filterableAttributes:['id','shop'],faceting:{maxValuesPerFacet:100000},pagination:{maxTotalHits:100000}};
const values=ids=>Object.fromEntries(ids.map(id=>[id,1]));

test('complete indexed ID membership avoids hydrating thousands of product documents',async()=>{
 const ids=Array.from({length:6000},(_,i)=>String(i+1)),filter=['shop = "fixture"','id IN '+JSON.stringify(ids),'option_Color = "Black"'];
 let searches=0;const index={getSettings:async()=>settings,getDocuments:()=>{throw Error('Product document hydration is not needed');},search:async(q,options)=>{
  searches++;assert.equal(q,'');assert.deepEqual(options.filter,filter);assert.deepEqual(options.facets,['id']);assert.deepEqual(options.attributesToRetrieve,[]);assert.equal(options.hitsPerPage,1);
  return {totalHits:ids.length,facetDistribution:{id:values(ids)}};
 }};
 assert.deepEqual(new Set(await collectionPriceCandidateIds(index,{filter})),new Set(ids));assert.equal(searches,1);
});

test('distinctness, unknown capabilities and insufficient caps retain the existing path',async()=>{
 for(const config of [{...settings,distinctAttribute:'vendor'},{...settings,filterableAttributes:['shop']},{...settings,faceting:{maxValuesPerFacet:1000}},{...settings,pagination:{maxTotalHits:1000}}]){
  const index={getSettings:async()=>config,search:()=>{throw Error('Unsafe facet lookup');},getDocuments:async options=>{assert.deepEqual(options.filter,['shop = "fixture"']);return {results:[{id:'2'}],total:1};}};
  assert.deepEqual(await collectionPriceCandidateIds(index,{filter:['shop = "fixture"']}),['2']);
 }
});

test('incomplete, capped, degraded and invalid facet responses cannot become complete memberships',async()=>{
 for(const response of [{estimatedTotalHits:1,facetDistribution:{id:{'1':1}}},{totalHits:2,facetDistribution:{id:{'1':1}}},{totalHits:1,facetDistribution:{id:{'1':2}}},{totalHits:1,facetDistribution:{id:{'not-an-id':1}}},{totalHits:1,facetDistribution:{id:{'1':1}},degraded:true},{totalHits:1,facetDistribution:{id:{'1':1}},exhaustiveNbHits:false},{totalHits:2,facetDistribution:{id:{'1':1,'2':1}}}]){
  assert.equal(await readIndexedProductIds({getSettings:async()=>settings,search:async()=>response},{filter:[],maxDocuments:2}),null);
 }
});

test('unsupported ID facets fall back to the complete original browse without dropping restrictions',async()=>{
 const filter=['shop = "fixture"','id IN ["2"]'];
 const index={getSettings:async()=>settings,search:async()=>{throw Error('Unsupported id facet');},getDocuments:async options=>{assert.deepEqual(options.filter,filter);return {results:[{id:'2'}],total:1};}};
 assert.deepEqual(await collectionPriceCandidateIds(index,{filter}),['2']);
});

test('indexed narrowing keeps the frozen parent order and rejects IDs outside its membership',async()=>{
 const parentIds=['4','3','2','1'],index={getSettings:async()=>settings,getDocuments:()=>{throw Error('Unnecessary document browse');},search:async(_q,options)=>{assert.ok(options.filter.includes('id IN ["4","3","2","1"]'));return {totalHits:2,facetDistribution:{id:{'2':1,'4':1}}};}};
 assert.deepEqual(await readNarrowerCollectionMembership(index,{filter:['shop = "fixture"'],parentIds,shop:'fixture'}),['4','2']);
 index.search=async()=>({totalHits:1,facetDistribution:{id:{'9':1}}});
 assert.equal(await readNarrowerCollectionMembership(index,{filter:['shop = "fixture"'],parentIds,shop:'fixture'}),null);
});
