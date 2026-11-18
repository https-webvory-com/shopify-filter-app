import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import * as semantic from '../../app/utils/semanticSearch.js';

async function fixture({weights=[{attribute:'title',weight:.2},{attribute:'handle',weight:1}],synonyms=[]}={}){
 const calls=[];
 const service=await loadModule('app/services/semanticSearch.server.js',{
  './meiliClient.server':{default:{index:uid=>({search:async(q,options)=>{calls.push({uid,q,options});return {hits:[],totalHits:37,totalPages:37,page:1,hitsPerPage:1,facetDistribution:{color:{Blue:37}}};}}),multiSearch:async request=>{
   calls.push(request);
   if(!request.federation)return {results:request.queries.map(()=>({hits:[],totalHits:37,totalPages:37,page:1,hitsPerPage:1}))};
   return {hits:[{id:'selected',_federation:{indexUid:'owner'}}],estimatedTotalHits:999,offset:request.federation.offset,limit:request.federation.limit};
  }}},
  './shopCache.server':{getCached:async(_key,read)=>read()},'../utils/semanticSearch.js':semantic,
  './searchIndex.server.js':{prepareConfiguredSearchQueries:async queries=>queries.map(query=>({...query,indexUid:'owner',attributesToSearchOn:weights.map(field=>field.attribute),_cfpFieldWeights:weights,_cfpSynonymQueries:synonyms,_cfpSemanticDisabled:true}))},
 });
 return {service,calls};
}

test('weighted searches rank globally and retain exact base counts, facets and tenant scope',async()=>{
 const {service,calls}=await fixture();
 const filter=['shop = "owner.myshopify.com"','available = true'];
 const result=await service.searchPageBatch([{q:'dress',filter,page:3,hitsPerPage:10,facets:['color']}],false);
 const ranked=JSON.parse(JSON.stringify(calls.find(call=>call.federation)));assert.deepEqual(ranked.federation,{offset:20,limit:10});
 assert.deepEqual(ranked.queries.map(query=>query.federationOptions.weight),[.1,.2,1]);
 for(const query of ranked.queries){assert.equal(query.indexUid,'owner');assert.deepEqual(query.filter,filter);assert.equal(query.page,undefined);assert.equal(query.hitsPerPage,undefined);assert.equal(query._cfpFieldWeights,undefined);assert.equal(query._cfpSemanticDisabled,undefined);}
 assert.deepEqual(ranked.queries[1].attributesToSearchOn,['title']);assert.deepEqual(ranked.queries[2].attributesToSearchOn,['handle']);
 assert.equal(result.results[0].totalHits,37);assert.equal(result.results[0].totalPages,4);assert.deepEqual(result.results[0].facetDistribution,{color:{Blue:37}});
 assert.equal(result.results[0].hits[0]._federation,undefined);
});

test('counts, explicit sorting and disabled field lists never leak private query options',async()=>{
 for(const weights of [[{attribute:'handle',weight:1}],[]]){
  const {service,calls}=await fixture({weights});
  await service.searchPageBatch([{q:'dress',page:1,hitsPerPage:1,attributesToRetrieve:[]}],false);
  await service.keywordSearch('dress',{sort:['price:asc'],offset:10,limit:5});
  assert.equal(calls.some(call=>call.federation),false);
  for(const call of calls){assert.equal(call.options._cfpFieldWeights,undefined);assert.equal(call.options._cfpSynonymQueries,undefined);}
  assert.deepEqual(calls[1].options.sort,['price:asc']);assert.equal(calls[1].options.offset,10);
 }
});
