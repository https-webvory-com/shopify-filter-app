import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionDependencies,describeCollectionDependencies,dependencyFallbackKey} from '../../app/utils/collectionDependencies.js';
import {createCollectionPreparation,preparationKey} from '../../app/utils/collectionPreparation.js';
import {productRevisionKey} from '../../app/utils/shopCacheInvalidation.js';

function fixture(){
 const values=new Map();const redis={get:async k=>values.get(k),mget:async(...keys)=>keys.map(k=>values.get(k)),
  set:async(k,v,mode)=>{if(mode==='XX'&&!values.has(k))return;if(mode!=='NX'||!values.has(k))values.set(k,v);},setex:async(k,_ttl,v)=>values.set(k,v),ttl:async()=>1000,
  incr:async k=>{values.set(k,String(Number(values.get(k)||0)+1));},del:async k=>values.delete(k)};
 const deps=createCollectionDependencies(redis),spec={shop:'fixture.myshopify.com',collectionId:'1',revision:'0',retainForIdle:true,needsShopifyOrder:true,sortBy:'best-selling',orderedIds:['1'],pinnedIds:['2'],query:{q:'',filter:[]},rule:{collectionTagMatching:'exact',conditions:[{action:'Include',field:'Tags',value:'TopProm'}]}};
 return {values,redis,deps,spec,descriptor:describeCollectionDependencies(spec)};
}

test('unrelated products and newly enrolled contexts do not invalidate existing exact tag/pin dependencies',async()=>{
 const f=fixture(),rev=await f.deps.revision(f.spec.shop,f.descriptor,{initialize:true});
 await f.deps.changed(f.spec.shop,{tags:['Unrelated'],ids:['99']});
 await f.deps.revision(f.spec.shop,describeCollectionDependencies({...f.spec,pinnedIds:['999']}),{initialize:true});
 assert.equal(await f.deps.revision(f.spec.shop,f.descriptor),rev);
 for(const proof of [{tags:['TopProm'],ids:['99']},{tags:[],ids:['2']}]){
  await f.deps.changed(f.spec.shop,proof);assert.notEqual(await f.deps.revision(f.spec.shop,f.descriptor),rev);
 }
});

test('removing a tag, deleting an explicit pin and case-sensitive Include changes retain complete invalidation coverage',async()=>{
 const f=fixture(),read=()=>f.deps.revision(f.spec.shop,f.descriptor,{initialize:true});let rev=await read();
 await f.deps.changed(f.spec.shop,{tags:['topprom'],ids:['99']});assert.equal(await read(),rev);
 // The producer sends the union of before/after tags, including a removed tag.
 await f.deps.changed(f.spec.shop,{tags:['TopProm','NewTag'],ids:['99']});assert.notEqual(await read(),rev);rev=await read();
 await f.deps.changed(f.spec.shop,{tags:[],ids:['gid://shopify/Product/2']});assert.notEqual(await read(),rev);
});

test('currently unavailable configured pins remain dependencies so becoming eligible cannot bypass refresh',async()=>{
 const f=fixture(),spec={...f.spec,pinnedIds:[],rule:null,pinningRule:{products:JSON.stringify([{id:'gid://shopify/Product/88'}])}};
 const descriptor=describeCollectionDependencies(spec);assert.ok(descriptor);
 const before=await f.deps.revision(spec.shop,descriptor,{initialize:true});
 await f.deps.changed(spec.shop,{tags:[],ids:['88']});assert.notEqual(await f.deps.revision(spec.shop,descriptor),before);
});

test('unknown changes invalidate supported contexts, and lost counter history never returns its old identity',async()=>{
 const f=fixture(),rev=await f.deps.revision(f.spec.shop,f.descriptor,{initialize:true});
 await f.deps.changed(f.spec.shop);assert.notEqual(await f.deps.revision(f.spec.shop,f.descriptor),rev);
 const before=await f.deps.revision(f.spec.shop,f.descriptor);
 f.values.delete([...f.values.keys()].find(k=>k.includes('collectionExternalInput:')));
 assert.equal(await f.deps.revision(f.spec.shop,f.descriptor),null);
 assert.notEqual(await f.deps.revision(f.spec.shop,f.descriptor,{initialize:true}),before);
 assert.ok(f.values.has(dependencyFallbackKey(f.spec.shop)));
});

test('unsupported predicates, malformed proofs, scopes and oversized descriptors retain conservative fallback',async()=>{
 const f=fixture();
 for(const condition of [{action:'Include',field:'Vendor',value:'TopProm'},{action:'Include',field:'Tags',value:'{bad'}]){
  assert.equal(describeCollectionDependencies({...f.spec,rule:{collectionTagMatching:'exact',conditions:[condition]}}),null);
 }
 assert.equal(describeCollectionDependencies({...f.spec,rule:{conditions:f.spec.rule.conditions}}),null);
 assert.equal(await f.deps.revision('other.myshopify.com',f.descriptor),null);
 assert.equal(await f.deps.revision(f.spec.shop,{version:1,tokens:['queue:foreign']}),null);
 assert.equal(describeCollectionDependencies({...f.spec,pinnedIds:Array.from({length:600},(_,i)=>String(i))}),null);
 const rev=await f.deps.revision(f.spec.shop,f.descriptor,{initialize:true});
 await f.deps.changed(f.spec.shop,{tags:['TopProm'],ids:[]});assert.notEqual(await f.deps.revision(f.spec.shop,f.descriptor),rev);
});

test('complete saved rankings survive unrelated global revisions but rebuild relevant changes after the existing freshness bound',async()=>{
 const f=fixture();let builds=0,time=100000;const queued=[];
 const queue={getJob:async()=>null,add:async(_name,data)=>queued.push(data)};
 const service=createCollectionPreparation({redis:f.redis,queue,dependencies:f.deps,now:()=>time,prepare:async()=>{builds++;return {ids:['2','1'],metadata:{}};}});
 await service.get(f.spec,{warmup:true,precompute:true});assert.equal(builds,1);
 const saved=JSON.parse(f.values.get(preparationKey(f.spec)));assert.equal(saved.externalDependencies.version,1);
 time+=7200000;await f.redis.incr(productRevisionKey(f.spec.shop,'all'));await f.deps.changed(f.spec.shop,{tags:['Other'],ids:['99']});
 assert.equal((await service.get(f.spec)).status,'ready');assert.equal(queued.length,0);
 await f.deps.changed(f.spec.shop,{tags:['TopProm'],ids:['99']});assert.equal((await service.get(f.spec)).status,'pending');
 await service.process(queued[0]);assert.equal(builds,2);assert.equal((await service.get(f.spec)).status,'ready');
});
