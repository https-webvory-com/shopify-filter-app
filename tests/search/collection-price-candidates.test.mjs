import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionPriceCandidateIds,savedPriceCollectionScope} from '../../app/utils/collectionPriceCandidates.js';

test('saved collection membership keeps exact exclusions and protected pins',()=>{
 const exclusions=['(NOT (available = false) OR id IN ["1"])','(NOT (id IN ["1","2"]) OR id IN ["1"])'];
 assert.deepEqual(savedPriceCollectionScope('10',exclusions,['gid://shopify/Product/1'],true),{collectionId:'gid://shopify/Collection/10',excludeIds:['2']});
 assert.equal(savedPriceCollectionScope('10',exclusions,[],false),null);
 assert.equal(savedPriceCollectionScope('10',['tags IN ["Excluded"]'],[],true),null);
});

test('saved price membership reads only indexed IDs without ranking the collection',async()=>{
 const filter=['shop = "fixture.myshopify.com"','collections = "1"'],reads=[];
 const ids=await collectionPriceCandidateIds({getDocuments:async options=>{reads.push(options);return {results:[{id:'1'},{id:'2'}],total:2};},search:()=>{throw Error('A collection-wide ranking search must not run');}},{filter});
 assert.deepEqual(ids,['1','2']);assert.deepEqual(reads[0].fields,['id']);assert.deepEqual(reads[0].filter,filter);
});

test('capped ID document reads finish their membership and reject unstable totals or duplicates',async()=>{
 const ids=await collectionPriceCandidateIds({getDocuments:async({offset})=>({results:offset?[{id:'3'}]:[{id:'1'},{id:'2'}],total:3})},{filter:[]});
 assert.deepEqual(ids,['1','2','3']);
 await assert.rejects(collectionPriceCandidateIds({getDocuments:async()=>({results:[{id:'1'},{id:'1'}],total:2})},{filter:[]}),/Incomplete/);
 let read=0;await assert.rejects(collectionPriceCandidateIds({getDocuments:async()=>({results:[{id:String(++read)}],total:read===1?2:3})},{filter:[]}),/changed/);
});

test('older document endpoints retain a complete ID-only search fallback',async()=>{
 const ids=await collectionPriceCandidateIds({getDocuments:async()=>{throw Object.assign(Error('Unsupported'),{httpStatus:405});},search:async(_q,options)=>{assert.deepEqual(options.attributesToRetrieve,['id']);return {hits:[{id:'1'}],totalHits:1};}},{filter:[]});
 assert.deepEqual(ids,['1']);
 await assert.rejects(collectionPriceCandidateIds({search:async()=>({hits:[{id:'1'}],totalHits:2})},{filter:[]}),/Incomplete/);
});
