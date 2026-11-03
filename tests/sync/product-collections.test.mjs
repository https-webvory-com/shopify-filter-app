import test from 'node:test';
import assert from 'node:assert/strict';
import { completeProductCollections } from '../../app/services/productCollections.server.js';
import { loadModule } from '../search/helpers/search-ranking.mjs';
import { isStorefrontProduct } from '../../app/utils/storefrontProduct.js';
const node = id => ({ id: String(id), title: `Collection ${id}`, handle: `c-${id}` });
const connection = (nodes, hasNextPage, endCursor) => ({ nodes, pageInfo: { hasNextPage, endCursor } });
test('all membership pages include collections after position 250 without duplicates', async () => {
  const product = { id: 'product', collections: connection(Array.from({length:250}, (_,i)=>node(i)), true, 'first') };
  const calls=[];
  await completeProductCollections({graphql:async (query,{variables})=>{
    calls.push(variables);
    assert.match(query,/after: \$cursor/);
    const page=variables.cursor==='first'?connection([node(249),node(339)],true,'second'):connection([node(383)],false,null);
    return {json:async()=>({data:{product:{collections:page}}})};
  }},product);
  assert.equal(product.collections.nodes.length,252);
  assert.ok(product.collections.nodes.some(n=>n.id==='339'));
  assert.deepEqual(calls,[{id:'product',cursor:'first'},{id:'product',cursor:'second'}]);
});
test('small products make no additional requests and empty membership is valid',async()=>{
  for(const nodes of [[],[node(1)]]){
    const product={collections:connection(nodes,false,null)};
    await completeProductCollections({graphql:()=>assert.fail('extra request')},product);
    assert.deepEqual(product.collections.nodes,nodes);
  }
});
test('failed, malformed, deleted and looping responses never replace original membership',async()=>{
  for(const reply of [{errors:[{message:'throttled'}]}, {data:{product:null}}, {data:{product:{collections:{nodes:[]}}}}, {data:{product:{collections:connection([node(2)],true,'first')}}}]){
    const original=connection([node(1)],true,'first');
    const product={id:'product',collections:original};
    await assert.rejects(completeProductCollections({graphql:async()=>({json:async()=>reply})},product));
    assert.equal(product.collections,original);
    assert.deepEqual(original.nodes,[node(1)]);
  }
});
test('missing initial metadata fails closed',async()=>{
  await assert.rejects(completeProductCollections({}, {collections:{nodes:[]}}));
});
test('actual single-product sync aborts before DB/index writes when membership pagination fails',async()=>{
  let writes=0;
  const service=await loadModule('app/services/sync.server.js',{
    './collectionRuleFacts.server.js':{withCollectionRuleFacts:async docs=>docs},
    '../utils/embeddingHold.js':{withHeldEmbeddingsForIndex:async(_index,docs)=>docs},
    '../utils/reconcileCollectionMembership.js':{},
    '../db.server':{default:{filterSetting:{findMany:async()=>[]},product:{deleteMany:async()=>{writes++;}}}},
    './productCollections.server.js':{completeProductCollections},
    '../utils/semanticSearch.js':{}, './meiliClient.server':{default:{index:()=>{writes++;throw Error('unexpected index write');}}},
    './shopCache.server':{}, '../utils/storefrontProduct.js':{isStorefrontProduct},
    '../utils/syncError.js':{}, '../utils/searchIndexProjection.js':{},
  });
  const product={id:'product',status:'ACTIVE',publishedAt:'2026-10-16',collections:connection([node(1)],true,'first')};
  const admin={graphql:async query=>({json:async()=>query.includes('getProduct(')?{data:{product}}:{errors:[{message:'failed'}]}})};
  await assert.rejects(service.syncSingleProduct('example.myshopify.com',admin,'product'),/complete product collection/);
  assert.equal(writes,0);
});
