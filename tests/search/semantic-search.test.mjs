import test from "node:test";
import assert from "node:assert/strict";
import { geminiEmbedder, withSemanticSearch, semanticFallback, semanticProvider, semanticEmbedderSettings, semanticRelayEmbedder } from "../../app/utils/semanticSearch.js";
import { loadModule } from './helpers/search-ranking.mjs';

test('edited multiword synonym branches retain filters, facets and pagination without stale alternatives',async()=>{
 let replacement='white dress';const calls=[];
 const service=await loadModule('app/services/semanticSearch.server.js',{
  './searchIndex.server.js':{prepareConfiguredSearchQueries:async queries=>queries.map(q=>({...q,indexUid:'private-owner',_cfpSynonymQueries:[replacement]}))},
  './meiliClient.server':{default:{multiSearch:async request=>{calls.push(JSON.parse(JSON.stringify(request)));return {hits:[{id:'white',_federation:{indexUid:'private-owner'}}],estimatedTotalHits:22,facetDistribution:{color:{White:22}}};}}},
  './shopCache.server':{getCached:async(_key,read)=>read()},
  '../utils/semanticSearch.js':{withSemanticSearch,semanticFallback,semanticProvider},
 });
 const scope={filter:["shop = 'owner.myshopify.com'","status = 'ACTIVE'"],sort:['priceMin:asc'],offset:10,limit:5,facets:['color']};
 const result=await service.keywordSearch('mani',scope);
 assert.deepEqual(calls[0].queries.map(q=>q.q),['mani','white dress']);
 for(const q of calls[0].queries){assert.deepEqual(q.filter,scope.filter);assert.deepEqual(q.sort,scope.sort);assert.equal(q.matchingStrategy,'all');assert.equal(q.offset,undefined);assert.equal(q._cfpSynonymQueries,undefined);}
 assert.equal(calls[0].federation.offset,10);assert.equal(calls[0].federation.limit,5);
 assert.deepEqual(calls[0].federation.facetsByIndex,{'private-owner':['color']});
 assert.equal(result.hits[0]._federation,undefined);assert.equal(result.estimatedTotalHits,22);
 replacement='blue dress';await service.semanticSearch('mani',scope);
 assert.deepEqual(calls[1].queries.map(q=>q.q),['mani','blue dress']);
 const counted=await service.searchPageBatch([{q:'mani',page:1,hitsPerPage:1}],false);
 assert.equal(counted.results[0].totalHits,1);
 assert.equal(counted.results[0].hits.length,1);
 assert.equal(calls[2].federation.page,undefined);
 assert.equal(calls[2].queries[0].page,undefined);
});

test('synonym page counts scan the complete union and retain fields beyond the first batch',async()=>{
 const catalog=Array.from({length:2003},(_,i)=>({id:String(i),title:'White dress '+i})),calls=[];
 const service=await loadModule('app/services/semanticSearch.server.js',{
  './searchIndex.server.js':{prepareConfiguredSearchQueries:async queries=>queries.map(q=>({...q,indexUid:'private-owner',_cfpSynonymQueries:['white dress']}))},
  './meiliClient.server':{default:{multiSearch:async({queries,federation})=>{
   calls.push(federation.offset);const idOnly=queries[0].attributesToRetrieve?.join(',')==='id';
   return {hits:catalog.slice(federation.offset,federation.offset+federation.limit).map(p=>idOnly?{id:p.id}:p),estimatedTotalHits:9999,facetDistribution:{color:{White:2003}}};
  }}},
  './shopCache.server':{getCached:async(_key,read)=>read()},
  '../utils/semanticSearch.js':{withSemanticSearch,semanticFallback,semanticProvider},
 });
 const {results:[result]}=await service.searchPageBatch([{q:'mani',page:2,hitsPerPage:1001}],false);
 assert.equal(result.totalHits,2003);assert.equal(result.hits.length,1001);
 assert.equal(result.hits[0].title,'White dress 1001');assert.equal(result.hits.at(-1).title,'White dress 2001');
 assert.deepEqual(calls,[0,1000,2000]);
 assert.equal(result.facetDistribution.color.White,2003);
});

test('single-word junk returns no products and multiword queries relax only after an empty strict pass', async () => {
  const calls = [];
  const service = await loadModule('app/services/semanticSearch.server.js', {
    './meiliClient.server': { default: { index: () => ({
      getEmbedders: async () => ({}),
      search: async (query, options) => {
        calls.push({ query, strategy: options.matchingStrategy });
        return { hits: options.matchingStrategy === 'all' ? [] : [{ id: 'relaxed' }] };
      },
    }) } },
    './shopCache.server': { getCached: async (_key, read) => read() },
    '../utils/semanticSearch.js': { withSemanticSearch, semanticFallback, semanticProvider },
  });
  assert.equal((await service.semanticSearch('xyzqq', {})).hits.length, 0);
  assert.deepEqual(calls.map(call => call.strategy), ['all']);
  calls.length = 0;
  assert.equal((await service.semanticSearch('red prom dress', {})).hits[0].id, 'relaxed');
  assert.deepEqual(calls.map(call => call.strategy), ['all', 'last']);
});

test('stop words are removed only after an exact search has no hits', async () => {
  const calls = [];
  const service = await loadModule('app/services/semanticSearch.server.js', {
    './meiliClient.server': { default: { index: () => ({ search: async (query, options) => {
      calls.push({ query, strategy: options.matchingStrategy });
      return { hits: query === 'dress wedding guest' ? [{ id: 'guest' }] : [] };
    } }) } },
    './shopCache.server': { getCached: async (_key, read) => read() },
    '../utils/semanticSearch.js': { withSemanticSearch, semanticFallback, semanticProvider },
  });
  const result = await service.semanticSearch('dress for wedding guest', {});
  assert.equal(result.hits[0].id, 'guest');
  assert.equal(result.relaxedQuery, 'dress wedding guest');
  assert.deepEqual(calls, [
    { query: 'dress for wedding guest', strategy: 'all' },
    { query: 'dress wedding guest', strategy: 'all' },
  ]);
});

test('page batches use a consistent provider mode and defer keyword restart to the whole page plan', async () => {
  const calls=[];
  const service=await loadModule('app/services/semanticSearch.server.js',{
    './meiliClient.server':{default:{index:()=>({getEmbedders:async()=>({openai:{source:'openAi'}})}),
      multiSearch:async({queries})=>{calls.push(queries);if(queries.some(q=>q.hybrid))throw Error('embedding unavailable');return {results:[{hits:[]}]};}}},
    './shopCache.server':{getCached:async(_k,read)=>read()},
    '../utils/semanticSearch.js':{withSemanticSearch,semanticFallback,semanticProvider:()=> 'openai'},
  });
  const queries=[{indexUid:'products',q:'mother wedding dress',filter:["shop = 'fixture'"],page:0,hitsPerPage:1}];
  assert.equal((await service.searchPageBatch(queries)).semantic,false);
  assert.equal(calls.length,2);assert.equal(calls[1][0].hybrid,undefined);
  await assert.rejects(service.searchPageBatch(queries,true),/embedding unavailable/);
  assert.equal((await service.searchPageBatch(queries,false)).semantic,false);
});

test('exhaustive keyword retrieval bypasses hybrid preparation and retains its complete scope', async () => {
  const calls = [];
  const service = await loadModule('app/services/semanticSearch.server.js', {
    './meiliClient.server': { default: { index: name => {
      assert.equal(name, 'products');
      return { search: async (query, options) => { calls.push({query, options}); return {hits: []}; } };
    } } },
    './shopCache.server': { getCached: () => { throw Error('must not consult semantic readiness'); } },
    '../utils/semanticSearch.js': { withSemanticSearch, semanticFallback, semanticProvider },
  });
  const options = { filter: ["shop = 'fixture'", "status = 'ACTIVE'", 'option_Color IN ["Red"]'],
    sort: ['priceMin:asc'], offset: 1000, limit: 1000 };
  await service.keywordSearch('red dress for wedding', options);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{query:'red dress for wedding', options:{...options,matchingStrategy:'all'}}]);
  assert.equal(calls[0].options.hybrid, undefined);
});
test('search pages use complete keyword facets and retain semantic fallback',async()=>{
 const calls=[];let count=120;
 const service=await loadModule('app/services/semanticSearch.server.js',{
  './meiliClient.server':{default:{index:()=>({getEmbedders:async()=>({openai:{source:'openAi'}})}),multiSearch:async({queries})=>{calls.push(queries);return {results:[{totalHits:queries[0].hybrid?86:count,facetDistribution:{vendor:queries[0].hybrid?{'Mac Duggal':26}:{'The Dress Outlet':56}}}]};}}},
  './shopCache.server':{getCached:async(_key,read)=>read()},
  '../utils/semanticSearch.js':{withSemanticSearch,semanticFallback,semanticProvider:()=> 'openai'},
 });
 const queries=[{indexUid:'products',q:'cocktail dress',filter:["shop = 'fixture'"],facets:['vendor'],limit:25}];
 const result=await service.semanticMultiSearch(queries,{preferKeyword:true});
 assert.equal(result.results[0].facetDistribution.vendor['The Dress Outlet'],56);
 assert.equal(calls.length,1);assert.equal(calls[0][0].hybrid,undefined);
 count=0;calls.length=0;
 await service.semanticMultiSearch(queries,{preferKeyword:true});
 assert.equal(calls.length,2);assert.ok(calls[1][0].hybrid);
});

test('search results prefer complete keyword facets while semantic fallback remains available',async()=>{
 const calls=[];let keywordHits=86;
 const service=await loadModule('app/services/semanticSearch.server.js',{
  './meiliClient.server':{default:{index:()=>({getEmbedders:async()=>({openai:{source:'openAi'}})}),multiSearch:async({queries})=>{calls.push(queries);return {results:[{totalHits:queries[0].hybrid?86:keywordHits,hits:keywordHits?[{id:'dress-outlet'}]:[],facetDistribution:{vendor:{'The Dress Outlet':56}}}]};}}},
  './shopCache.server':{getCached:async(_key,read)=>read()},
  '../utils/semanticSearch.js':{withSemanticSearch,semanticFallback,semanticProvider:()=> 'openai'},
 });
 const queries=[{indexUid:'products',q:'cocktail dress',filter:["shop = 'fixture'"],facets:['vendor'],limit:25}];
 const lexical=await service.semanticMultiSearch(queries,{preferKeyword:true});
 assert.equal(lexical.results[0].facetDistribution.vendor['The Dress Outlet'],56);
 assert.equal(calls.length,1);assert.equal(calls[0][0].hybrid,undefined);
 keywordHits=0;calls.length=0;
 await service.semanticMultiSearch(queries,{preferKeyword:true});
 assert.equal(calls.length,2);assert.ok(calls[1][0].hybrid);
});

test("semantic requests retain tenant, filters, page and explicit sort", () => {
  const query = { q: "dress for beach wedding", filter: ["shop = 'fixture'", "available = true"], sort: ["priceMin:asc"], offset: 25, limit: 25 };
  const prepared = withSemanticSearch(query, true);
  assert.deepEqual(prepared, { ...query, hybrid: { embedder: "openai", semanticRatio: 0.5 } });
  assert.equal(withSemanticSearch(query, false), query);
  const empty = { q: "", filter: query.filter };
  assert.equal(withSemanticSearch(empty, true), empty);
});

test('OpenAI is selected by default even when a Gemini key exists', () => {
  assert.equal(semanticProvider({GEMINI_API_KEY:'gemini-key'}), 'openai');
  const settings = semanticEmbedderSettings({OPENAI_API_KEY:'openai-key',GEMINI_API_KEY:'gemini-key'});
  assert.equal(settings.openai.source, 'openAi');
  assert.equal(settings.openai.apiKey, 'openai-key');
  assert.equal(settings.openai.model, 'text-embedding-3-small');
  assert.equal(settings.openai.dimensions, 768);
  assert.equal(settings.default, null);
  assert.equal(settings.gemini, null);
  assert.throws(()=>semanticEmbedderSettings({GEMINI_API_KEY:'gemini-key'}), /OPENAI_API_KEY/);
});

test('Gemini requires an explicit switch and its own key', () => {
  const settings = semanticEmbedderSettings({SEMANTIC_EMBEDDING_PROVIDER:'gemini',GEMINI_API_KEY:'gemini-key'});
  assert.equal(settings.openai, null);
  assert.equal(settings.gemini.source, 'rest');
  assert.equal(settings.gemini.request.model, 'models/gemini-embedding-2');
  assert.equal(withSemanticSearch({q:'dress'},true,'gemini').hybrid.embedder, 'gemini');
  assert.throws(()=>semanticEmbedderSettings({SEMANTIC_EMBEDDING_PROVIDER:'gemini',OPENAI_API_KEY:'openai-key'}), /GEMINI_API_KEY/);
  assert.throws(()=>semanticProvider({SEMANTIC_EMBEDDING_PROVIDER:'invalid'}), /Unsupported/);
});

test('relay setup pins the provider and rejects partial configuration', () => {
  const env = {OPENAI_API_KEY:'key',SEMANTIC_RELAY_URL:'https://fixture/embeddings',SEMANTIC_RELAY_TOKEN:'token'};
  assert.deepEqual(semanticEmbedderSettings(env).openai, semanticRelayEmbedder(env.SEMANTIC_RELAY_URL,env.SEMANTIC_RELAY_TOKEN,'openai'));
  assert.equal(semanticEmbedderSettings(env).openai.request.provider, 'openai');
  assert.throws(()=>semanticEmbedderSettings({...env,SEMANTIC_RELAY_TOKEN:''}), /required/);
});

test("provider failure retries the entire batch as keyword search, including facets", async () => {
  const queries = [{ q: "wedding outfit", filter: ["shop = 'fixture'"], limit: 25 }, { q: "wedding outfit", facets: ["vendor"], limit: 0 }];
  const calls = [];
  const result = await semanticFallback(async batch => {
    calls.push(batch);
    if (batch.some(query => query.hybrid)) throw new Error("Embedding unavailable");
    return { results: [{ hits: [{ id: "1" }] }, { facetDistribution: { vendor: { Example: 1 } } }] };
  }, queries.map(query => withSemanticSearch(query, true)));
  assert.deepEqual(calls[1], queries);
  assert.equal(result.results[0].hits[0].id, "1");
  assert.equal(result.results[1].facetDistribution.vendor.Example, 1);
});

test("ordinary keyword errors propagate without a redundant retry", async () => {
  let calls = 0;
  await assert.rejects(semanticFallback(async () => { calls++; throw new Error("offline"); }, [{ q: "" }]), /offline/);
  assert.equal(calls, 1);
});

test("Gemini embedding configuration uses document fields and matching dimensions", () => {
  const config = geminiEmbedder("fixture-key");
  assert.match(config.documentTemplate, /field.name == 'title'/);
  assert.match(config.documentTemplate, /field.name == 'option_Color'/);
  assert.match(config.documentTemplate, /field.value != nil/);
  assert.equal(config.dimensions, config.request.outputDimensionality);
  assert.equal(config.response.embedding.values, "{{embedding}}");
});
