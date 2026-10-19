import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionPreparation, preparationKey, preparationOrderFallbackKey, preparationRevisionKey, preparationLifetime} from '../../app/utils/collectionPreparation.js';
import {productRevisionKey} from '../../app/utils/shopCacheInvalidation.js';

function fixture() {
  const values=new Map(),jobs=new Map(),queued=[];let clock=100000,builds=0;
  const redis={get:async key=>values.get(key),ttl:async()=>600,setex:async(key,_ttl,value)=>values.set(key,value),del:async key=>values.delete(key)};
  const queue={getJob:async id=>jobs.get(id),add:async(name,data,{jobId,priority})=>{
    if(jobs.has(jobId))return jobs.get(jobId);
    const job={name,data,opts:{priority},finishedOn:0,state:'waiting',getState:async()=>job.state,remove:async()=>jobs.delete(jobId),changePriority:async({priority})=>{job.opts.priority=priority;}};
    jobs.set(jobId,job);queued.push(job);return job;
  }};
  const result={ids:['pin','boost','ordinary'],metadata:{pin:{merchandisingImage:'pin.jpg'}}};
  const service=createCollectionPreparation({redis,queue,prepare:async()=>{builds++;return result;},now:()=>clock});
  const spec={shop:'fixture.myshopify.com',revision:'0',sortBy:'best-selling',query:{q:'',filter:["shop = 'fixture.myshopify.com'"]},rule:{conditions:[]}};
  return {service,spec,result,values,jobs,queued,redis,queue,builds:()=>builds,advance:ms=>clock+=ms};
}

test('catalog precompute finishes a complete ranking before the first visitor without enqueueing another build',async()=>{
 const f=fixture();f.spec.retainForIdle=true;
 const ready=await f.service.get(f.spec,{warmup:true,precompute:true});
 assert.deepEqual(ready,{status:'ready',...f.result});assert.equal(f.builds(),1);assert.equal(f.queued.length,0);
 assert.deepEqual(await f.service.get(f.spec),ready);assert.equal(f.builds(),1);
 await f.service.get(f.spec,{warmup:true,precompute:true});assert.equal(f.builds(),1);
 f.values.set(productRevisionKey(f.spec.shop,f.spec.collectionId),'1');
 await f.service.get(f.spec,{warmup:true,precompute:true});assert.equal(f.builds(),2);
});

test('failed or superseded catalog precompute never publishes or reports a ready ranking',async()=>{
 const f=fixture();f.spec.retainForIdle=true;
 const failed=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>{throw Error('Unavailable index');}});
 await assert.rejects(failed.get(f.spec,{warmup:true,precompute:true}),/Unavailable index/);assert.equal(f.values.has(preparationKey(f.spec)),false);
 const racing=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>{f.values.set(preparationRevisionKey(f.spec.shop),'changed');return f.result;}});
 assert.deepEqual(await racing.get(f.spec,{warmup:true,precompute:true}),{status:'pending'});assert.equal(f.values.has(preparationKey(f.spec)),false);
});

test('a first visitor publishes maintained rank inputs directly without waiting for the background queue',async()=>{
 const f=fixture();f.spec.retainForIdle=true;let reads=0;
 const s=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:()=>{throw Error('Full scan forbidden');},prepareDirect:async()=>{reads++;return f.result;}});
 const first=await s.get(f.spec);assert.deepEqual(first,{status:'ready',...f.result});assert.equal(reads,1);assert.equal(f.queued.length,0);
 assert.deepEqual(await s.get(f.spec),first);assert.equal(reads,1);
});

test('concurrent first visitors share one direct ranking and configuration races never publish old results',async()=>{
 const f=fixture();f.spec.retainForIdle=true;let complete,reads=0;
 const s=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>f.result,prepareDirect:async()=>{reads++;return new Promise(resolve=>complete=resolve);}});
 const requests=Array.from({length:40},()=>s.get(f.spec));await new Promise(resolve=>setImmediate(resolve));complete(f.result);
 assert.ok((await Promise.all(requests)).every(r=>r.status==='ready'));assert.equal(reads,1);assert.equal(f.queued.length,0);
 const other={...f.spec,sortBy:'price-ascending'};const pending=s.get(other);await new Promise(resolve=>setImmediate(resolve));f.values.set(preparationRevisionKey(other.shop),'1');complete(f.result);
 assert.equal((await pending).status,'pending');assert.equal(f.values.has(preparationKey(other)),false);
});

test('missing or failed facts preserve the existing queued path and never cache incomplete data or replay private contexts',async()=>{
 const f=fixture();f.spec.retainForIdle=true;let reads=0;
 const s=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>f.result,prepareDirect:async()=>{reads++;throw Error('Facts missing');}});
 assert.equal((await s.get(f.spec)).status,'pending');assert.equal((await s.get(f.spec)).status,'pending');assert.equal(reads,1);assert.equal(f.queued.length,1);
 assert.equal(f.values.has(preparationKey(f.spec)),false);
 await s.get({...f.spec,retainForIdle:false,query:{filter:["Color = 'Blue'"]}});assert.equal(reads,1);
});

test('readiness diagnostics distinguish a missing key, queue wait and build duration without changing products',async()=>{
 const f=fixture(),events=[];let clock=100;
 const service=createCollectionPreparation({redis:f.redis,queue:f.queue,now:()=>clock,observe:event=>events.push(event),prepare:async()=>{clock+=250;return f.result;}});
 await service.get(f.spec);clock+=500;await service.process(f.queued[0].data);
 assert.equal(events.find(e=>e.event==='unavailable').reason,'missing');assert.equal(events.find(e=>e.event==='build-started').queueWaitMs,500);assert.equal(events.find(e=>e.event==='build-ready').buildMs,250);
 assert.deepEqual(await service.get(f.spec),{status:'ready',...f.result});
 const harmless=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>f.result,observe:()=>{throw Error('diagnostics offline');}});
 assert.equal((await harmless.get({...f.spec,revision:'0',sortBy:'price-ascending'})).status,'pending');
});

test('a missing ranking queues once across concurrent requests without scanning on the web request',async()=>{
  const f=fixture();const results=await Promise.all([f.service.get(f.spec),f.service.get(f.spec)]);
  assert.deepEqual(results,[{status:'pending'},{status:'pending'}]);assert.equal(f.queued.length,1);assert.equal(f.builds(),0);
  await f.service.process(f.queued[0].data);
  assert.deepEqual(await f.service.get(f.spec),{status:'ready',...f.result});assert.equal(f.builds(),1);
});

test('admin invalidation cannot publish a build that started under an older revision',async()=>{
  const f=fixture();let finish;
  const service=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>new Promise(resolve=>finish=resolve)});
  await service.get(f.spec);const task=service.process(f.queued[0].data);
  await new Promise(resolve=>setImmediate(resolve));
  f.values.set(preparationRevisionKey(f.spec.shop),'1');finish(f.result);
  assert.deepEqual(await task,{superseded:true});assert.equal(f.values.has(preparationKey(f.spec)),false);
  assert.deepEqual(await service.get(f.spec),{status:'pending'});
  const updated={...f.spec,revision:'1'};await service.get(updated);assert.equal(f.queued.length,2);
});

test('invalidation after reading a cached value rejects the old sequence',async()=>{
  const f=fixture();f.values.set(preparationKey(f.spec),JSON.stringify(f.result));
  const original=f.redis.get;f.redis.get=async key=>{const value=await original(key);if(key===preparationKey(f.spec))f.values.set(preparationRevisionKey(f.spec.shop),'1');return value;};
  assert.deepEqual(await f.service.get(f.spec),{status:'pending'});
});

test('keys are compact, stable across queue serialization, and isolate pins, rules, orders, markets and shops',()=>{
  const f=fixture();const dated={...f.spec,rule:{updatedAt:new Date('2026-10-13'),conditions:[]}};
  assert.equal(preparationKey(dated),preparationKey(JSON.parse(JSON.stringify(dated))));
  assert.equal(preparationKey(f.spec),preparationKey({...f.spec,query:{filter:f.spec.query.filter,q:''}}));
  assert.ok(preparationKey({...f.spec,mergedValues:Array(10000).fill('blue')}).length<160);
  for(const change of [{shop:'other.myshopify.com'},{revision:'1'},{pinnedIds:['other']},{rule:{conditions:[{action:'Exclude',field:'Tags',value:'sold'}]}},{orderedIds:['2','1']},{globalSettings:{prioritizeSortOverPinning:true}},{query:{...f.spec.query,filter:["country = 'CA'"]}}])assert.notEqual(preparationKey(f.spec),preparationKey({...f.spec,...change}));
});

test('failed preparation jobs respect cooldown and retry instead of serving fallback ordering',async()=>{
  const f=fixture();await f.service.get(f.spec);const job=f.queued[0];job.state='failed';job.finishedOn=100000;
  assert.deepEqual(await f.service.get(f.spec),{status:'failed'});assert.equal(f.queued.length,1);
  f.advance(31000);assert.deepEqual(await f.service.get(f.spec),{status:'pending'});assert.equal(f.queued.length,2);
});

test('expired prepared records schedule a new job even if the previous job completed',async()=>{
  const f=fixture();await f.service.get(f.spec);f.queued[0].state='completed';
  assert.deepEqual(await f.service.get(f.spec),{status:'pending'});assert.equal(f.queued.length,2);
});

test('a valid ranking remains available if proactive refresh scheduling fails',async()=>{
  const f=fixture();f.values.set(preparationKey(f.spec),JSON.stringify(f.result));f.redis.ttl=async()=>10;f.queue.add=async()=>{throw Error('queue down');};
  assert.deepEqual(await f.service.get(f.spec),{status:'ready',...f.result});
});

test('invalid worker identity and failed scans cannot populate prepared cache',async()=>{
  const f=fixture();await assert.rejects(f.service.process({key:'wrong',spec:f.spec}),/identity/);
  const service=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>{throw Error('incomplete scan');}});
  await assert.rejects(service.process({key:preparationKey(f.spec),spec:f.spec}),/incomplete scan/);
  assert.equal(f.values.has(preparationKey(f.spec)),false);
});

test('an active visitor promotes a queued background warmup without duplicating the build',async()=>{
  const f=fixture();await f.service.get(f.spec,{warmup:true});assert.equal(f.queued[0].opts.priority,10);
  await f.service.get(f.spec);assert.equal(f.queued.length,1);assert.equal(f.queued[0].opts.priority,1);
});

test('relevant product updates permit a cold build to publish and request a follow-up refresh',async()=>{
  const f=fixture();f.spec.collectionId='1';let finish;
  const service=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>new Promise(resolve=>finish=resolve)});
  await service.get(f.spec);const task=service.process(f.queued[0].data);
  await new Promise(resolve=>setImmediate(resolve));
  f.values.set(productRevisionKey(f.spec.shop,'1'),'27');finish(f.result);
  assert.deepEqual(await task,{products:3,refreshRequired:true});
  assert.deepEqual(await service.get(f.spec),{status:'ready',...f.result});
  assert.equal(JSON.parse(f.values.get(preparationKey(f.spec))).productRevision,'0');
});

test('unrelated product updates preserve the collection data version and cached ranking',async()=>{
  const f=fixture();f.spec.collectionId='1';await f.service.get(f.spec);
  f.values.set(productRevisionKey(f.spec.shop,'2'),'100');
  assert.deepEqual(await f.service.process(f.queued[0].data),{products:3,refreshRequired:false});
  assert.deepEqual(await f.service.get(f.spec),{status:'ready',...f.result});
  assert.equal(f.queued.length,1);
  assert.equal(preparationKey(f.spec),preparationKey({...f.spec,productRevision:'999'}));
});

test('page size, offsets and response fields reuse the complete ranking but filters stay isolated',()=>{
  const f=fixture();const a={...f.spec,query:{...f.spec.query,limit:25,offset:0,attributesToRetrieve:['title']}};
  const b={...f.spec,query:{...f.spec.query,limit:250,offset:5000,attributesToRetrieve:['images'],facets:['vendor']}};
  assert.equal(preparationKey(a),preparationKey(b));
  assert.notEqual(preparationKey(a),preparationKey({...b,query:{...b.query,filter:["vendor = 'Other'"]}}));
});

test('corrupt cached records queue recovery and cannot render or delete a concurrent publication',async()=>{
  for(const raw of ['{broken',JSON.stringify({ids:['duplicate','duplicate'],metadata:{}}),JSON.stringify({ids:[],metadata:null}),JSON.stringify({ids:[null],metadata:{}})]){
    const f=fixture();f.values.set(preparationKey(f.spec),raw);
    assert.deepEqual(await f.service.get(f.spec),{status:'pending'});assert.equal(f.queued.length,1);
    await f.service.process(f.queued[0].data);assert.deepEqual(await f.service.get(f.spec),{status:'ready',...f.result});
  }
});

test('invalid scan output never replaces a usable prepared ranking',async()=>{
  const f=fixture();const raw=JSON.stringify({...f.result,productRevision:'0'});f.values.set(preparationKey(f.spec),raw);
  const service=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>({ids:['1','1'],metadata:{}})});
  await assert.rejects(service.process({key:preparationKey(f.spec),spec:f.spec}),/Invalid prepared/);
  assert.equal(f.values.get(preparationKey(f.spec)),raw);
});

test('empty collections are valid ready results rather than endless pending jobs',async()=>{
  const f=fixture();const service=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>({ids:[],metadata:{}})});
  await service.get(f.spec);await service.process(f.queued[0].data);
  assert.deepEqual(await service.get(f.spec),{status:'ready',ids:[],metadata:{}});
});

test('updates while waiting in a backlog do not require another build if data stays stable during the scan',async()=>{
  const f=fixture();f.spec.collectionId='1';await f.service.get(f.spec);
  f.values.set(productRevisionKey(f.spec.shop,'1'),'20');
  assert.deepEqual(await f.service.process(f.queued[0].data),{products:3,refreshRequired:false});
  assert.equal(JSON.parse(f.values.get(preparationKey(f.spec))).productRevision,'20');
});

test('obsolete first-page preparation can be discarded without deleting existing browsing sessions',async()=>{
  const f=fixture();await f.service.get(f.spec);await f.service.process(f.queued[0].data);
  f.values.set('collectionRankingSession:fixture.myshopify.com:token','session');
  await f.service.discard(f.spec);assert.equal(f.values.has(preparationKey(f.spec)),false);
  assert.equal(f.values.get('collectionRankingSession:fixture.myshopify.com:token'),'session');
});

test('configuration change immediately after publication removes the outdated record',async()=>{
  const f=fixture();const original=f.redis.setex;
  f.redis.setex=async(...args)=>{await original(...args);f.values.set(preparationRevisionKey(f.spec.shop),'1');};
  await f.service.get(f.spec);assert.deepEqual(await f.service.process(f.queued[0].data),{superseded:true});
  assert.equal(f.values.has(preparationKey(f.spec)),false);
});

test('Redis and queue failures are surfaced instead of silently serving fallback order',async()=>{
  const f=fixture();f.queue.add=async()=>{throw Error('Queue unavailable');};
  await assert.rejects(f.service.get(f.spec),/Queue unavailable/);
  f.redis.get=async()=>{throw Error('Redis unavailable');};
  await assert.rejects(f.service.get(f.spec),/Redis unavailable/);
});

test('idle beyond ten minutes serves the last usable ranking and refreshes in the background',async()=>{
  const f=fixture();f.spec.retainForIdle=true;let storedLifetime;
  const original=f.redis.setex;f.redis.setex=async(key,ttl,value)=>{storedLifetime=ttl;return original(key,ttl,value);};
  await f.service.get(f.spec);await f.service.process(f.queued[0].data);f.queued[0].state='completed';
  assert.equal(storedLifetime,86400);assert.equal(preparationLifetime,86400);
  f.advance(660000);assert.deepEqual(await f.service.get(f.spec),{status:'ready',...f.result});
  assert.equal(f.builds(),1);assert.equal(f.queued.length,2);assert.equal(f.queued[1].opts.priority,10);
  const oldKey=preparationKey(f.spec);f.values.set(preparationRevisionKey(f.spec.shop),'1');
  assert.deepEqual(await f.service.get(f.spec),{status:'pending'});
  assert.equal((await f.service.get({...f.spec,revision:'1'})).status,'pending');
  assert.notEqual(preparationKey({...f.spec,revision:'1'}),oldKey);
});

test('filtered or customer-specific contexts keep short retention and retention does not change ranking identity',async()=>{
  const f=fixture();let storedLifetime;const original=f.redis.setex;
  f.redis.setex=async(key,ttl,value)=>{storedLifetime=ttl;return original(key,ttl,value);};
  await f.service.get(f.spec);await f.service.process(f.queued[0].data);assert.equal(storedLifetime,600);
  assert.equal(preparationKey(f.spec),preparationKey({...f.spec,retainForIdle:true}));
});

test('long retention cannot keep known product changes stale beyond the existing freshness window',async()=>{
  const f=fixture();f.spec.retainForIdle=true;f.spec.collectionId='1';
  await f.service.get(f.spec);await f.service.process(f.queued[0].data);f.queued[0].state='completed';
  f.values.set(productRevisionKey(f.spec.shop,'1'),'1');f.advance(660000);
  assert.equal((await f.service.get(f.spec)).status,'pending');
  assert.equal(f.queued.at(-1).opts.priority,1);
  await f.service.process(f.queued.at(-1).data);
  assert.deepEqual(await f.service.get(f.spec),{status:'ready',...f.result});
});

test('fresh preparation does not rebuild on every request and legacy records refresh without blanking',async()=>{
  const f=fixture();await f.service.get(f.spec);await f.service.process(f.queued[0].data);f.queued[0].state='completed';
  f.advance(240000);await f.service.get(f.spec);assert.equal(f.queued.length,1);
  f.values.set(preparationKey(f.spec),JSON.stringify({...f.result,productRevision:'0'}));
  assert.equal((await f.service.get(f.spec)).status,'ready');assert.equal(f.queued.length,2);
});

test('a changed Shopify order keeps the last complete fresh ranking while its replacement queues at low priority',async()=>{
 const f=fixture();Object.assign(f.spec,{retainForIdle:true,needsShopifyOrder:true,orderedIds:['pin','boost','ordinary'],orderRevision:'old',orderUpdatedAt:10});
 await f.service.get(f.spec);await f.service.process(f.queued[0].data);f.queued[0].state='completed';
 const changed={...f.spec,orderedIds:['ordinary','boost','pin'],orderRevision:'new',orderUpdatedAt:20};
 const ready=await f.service.get(changed);
 assert.equal(ready.status,'ready');assert.deepEqual(ready.ids,f.result.ids);assert.equal(ready.orderUpdatedAt,10);
 assert.equal(ready.cacheKey,preparationKey(f.spec));assert.equal(f.queued.length,2);assert.equal(f.queued[1].opts.priority,10);
 const built={ids:['ordinary','boost','pin'],metadata:{}};
 const service=createCollectionPreparation({redis:f.redis,queue:f.queue,prepare:async()=>built});
 await service.process(f.queued[1].data);
 assert.deepEqual(await service.get(changed),{status:'ready',...built});
 assert.equal(f.values.get(preparationOrderFallbackKey(changed)),preparationKey(changed));
});

test('last-order reuse cannot cross eligibility, configuration, market rules, shops or retention boundaries',async()=>{
 for(const change of [{revision:'1'},{shop:'other.myshopify.com'},{pinnedIds:['different']},{query:{filter:["Color = 'Red'"]}},{rule:{conditions:[{field:'Tags',action:'Exclude',value:'hidden'}]}},{retainForIdle:false}]){
  const f=fixture();Object.assign(f.spec,{retainForIdle:true,needsShopifyOrder:true,orderedIds:['old'],orderRevision:'old'});
  await f.service.get(f.spec);await f.service.process(f.queued[0].data);f.queued[0].state='completed';
  const changed={...f.spec,orderedIds:['new'],orderRevision:'new',...change};
  assert.equal((await f.service.get(changed)).status,'pending',JSON.stringify(change));
 }
 for(const reason of ['age','product']){
  const f=fixture();Object.assign(f.spec,{retainForIdle:true,needsShopifyOrder:true,collectionId:'1',orderedIds:['old']});
  await f.service.get(f.spec);await f.service.process(f.queued[0].data);f.queued[0].state='completed';
  if(reason==='age')f.advance(preparationLifetime*1000);else f.values.set(productRevisionKey(f.spec.shop,'1'),'1');
  assert.equal((await f.service.get({...f.spec,orderedIds:['new']})).status,'pending',reason);
 }
});

test('an idle collection reuses unchanged products across an order refresh without waiting for the worker',async()=>{
 const f=fixture();Object.assign(f.spec,{retainForIdle:true,needsShopifyOrder:true,collectionId:'1',orderedIds:['old'],orderUpdatedAt:10});
 await f.service.get(f.spec);await f.service.process(f.queued[0].data);f.queued[0].state='completed';
 f.advance(660000);
 const changed={...f.spec,orderedIds:['new'],orderUpdatedAt:20};
 const ready=await f.service.get(changed);
 assert.equal(ready.status,'ready');assert.deepEqual(ready.ids,f.result.ids);
 assert.equal(ready.orderUpdatedAt,10);assert.equal(ready.cacheKey,preparationKey(f.spec));
 assert.equal(f.queued.length,2);assert.equal(f.queued[1].opts.priority,10);assert.equal(f.builds(),1);
 f.values.set(productRevisionKey(f.spec.shop,'1'),'1');
 assert.equal((await f.service.get(changed)).status,'pending');
 assert.equal(f.queued[1].opts.priority,1);
});

test('a last-order sequence with newly ineligible products is discarded without touching browsing tokens',async()=>{
 const f=fixture();Object.assign(f.spec,{retainForIdle:true,needsShopifyOrder:true,orderedIds:['old']});
 await f.service.get(f.spec);await f.service.process(f.queued[0].data);f.queued[0].state='completed';
 const changed={...f.spec,orderedIds:['new']};const ready=await f.service.get(changed);
 f.values.set('collectionRankingSession:fixture.myshopify.com:token','untouched');
 await f.service.discard(changed,ready.cacheKey);
 assert.equal((await f.service.get(changed)).status,'pending');
 assert.equal(f.values.get('collectionRankingSession:fixture.myshopify.com:token'),'untouched');
 await assert.rejects(f.service.discard(changed,'collectionPreparedSequence:other.myshopify.com:background-v2:'+'a'.repeat(64)),/Invalid/);
});

test('snapshot refresh time alone does not change the preparation identity',()=>{
 const f=fixture();assert.equal(preparationKey({...f.spec,orderUpdatedAt:1}),preparationKey({...f.spec,orderUpdatedAt:2}));
});

test('a ready record from before deployment can seed last-order reuse without rebuilding',async()=>{
 const f=fixture();Object.assign(f.spec,{retainForIdle:true,needsShopifyOrder:true,orderedIds:['old']});
 f.values.set(preparationKey(f.spec),JSON.stringify({...f.result,preparedAt:100000,productRevision:'0'}));
 assert.equal((await f.service.get(f.spec)).status,'ready');assert.equal(f.builds(),0);
 const reused=await f.service.get({...f.spec,orderedIds:['new']});
 assert.equal(reused.status,'ready');assert.equal(reused.orderUpdatedAt,null);assert.deepEqual(reused.ids,f.result.ids);
});
