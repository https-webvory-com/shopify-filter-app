import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as helpers from '../../app/utils/semanticSearch.js';

async function fixture(embedders, env = {}) {
  const calls = [], keys = [];
  const index = {getEmbedders:async()=>embedders,search:async(q,params)=>{calls.push({q,...params});return {hits:[]};}};
  const mocks = {
    './searchIndex.server.js':{prepareConfiguredSearchQueries:async queries=>queries.map(q=>({...q,indexUid:q.indexUid||'products'}))},
    './meiliClient.server':{__esModule:true,default:{index:()=>index,multiSearch:async({queries})=>{calls.push(...queries);return {results:[]};}}},
    './shopCache.server':{getCached:async(key,read)=>{keys.push(key);return read();}},
    '../utils/semanticSearch.js':{...helpers,semanticProvider:()=>helpers.semanticProvider(env)},
  };
  const context={module:{exports:{}},exports:{},process:{env},require:name=>mocks[name]};
  vm.runInNewContext((await transform(await fs.readFile('app/services/semanticSearch.server.js','utf8'),{format:'cjs'})).code,context);
  return {...context.module.exports,calls,keys};
}

test('a configured Gemini legacy default cannot activate OpenAI semantic queries', async () => {
  const service = await fixture({default:helpers.geminiEmbedder('key'),gemini:helpers.geminiEmbedder('key')});
  await service.semanticSearch('summer outfit',{filter:["shop = 'fixture'"]});
  assert.equal(service.calls[0].hybrid,undefined);
});

test('OpenAI queries and facet batches use only the OpenAI embedder', async () => {
  const service = await fixture({openai:helpers.openaiEmbedder('key'),gemini:helpers.geminiEmbedder('key')});
  await service.semanticSearch('summer outfit',{filter:["shop = 'fixture'"],offset:25});
  await service.semanticMultiSearch([{q:'summer outfit',facets:['vendor']},{q:'',limit:0}]);
  assert.equal(service.calls[0].matchingStrategy,'all');
  assert.equal(service.calls[0].hybrid,undefined);
  assert.equal(service.calls[1].hybrid.embedder,'openai');
  assert.equal(service.calls[1].offset,25);
  assert.deepEqual(Array.from(service.calls[1].filter),["shop = 'fixture'"]);
  assert.equal(service.calls[2].hybrid.embedder,'openai');
  assert.equal(service.calls[3].hybrid,undefined);
  assert.ok(service.keys.every(key=>key.endsWith(':openai:products')));
});

test('explicit Gemini selection and disabling semantic search are respected', async () => {
  const service = await fixture({gemini:helpers.geminiEmbedder('key')},{SEMANTIC_EMBEDDING_PROVIDER:'gemini'});
  await service.semanticSearch('summer outfit',{});
  assert.equal(service.calls[0].matchingStrategy,'all');
  assert.equal(service.calls[1].hybrid.embedder,'gemini');
  const disabled=await fixture({openai:helpers.openaiEmbedder('key')},{SEMANTIC_SEARCH_ENABLED:'false'});
  await disabled.semanticSearch('summer outfit',{});
  assert.equal(disabled.calls[0].hybrid,undefined);
  assert.equal(disabled.calls[1].hybrid,undefined);
  assert.equal(disabled.keys.length,0);
});
