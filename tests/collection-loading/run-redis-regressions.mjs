import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fork} from 'node:child_process';
import {createRedisTestLayer} from './redis-layer.mjs';
import {createShopCacheInvalidation,configurationRevisionKey,productRevisionKey} from '../../app/utils/shopCacheInvalidation.js';
import {createCollectionPreparation,preparationKey,publicRetentionKey,publicPreparationLimit} from '../../app/utils/collectionPreparation.js';

const layer=await createRedisTestLayer({workerOptions:{lockDuration:3000,stalledInterval:1000}});
const shop='redis-regression.myshopify.com';
const results=[];
const wait=async predicate=>{const start=Date.now();while(Date.now()-start<30000){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Redis regression timed out');};
let child;
try{
  await layer.worker.pause();
  const invalidate=createShopCacheInvalidation({redis:layer.redis});
  const id='warm-'+shop;
  const data={shop,collectionIds:['1']};
  await layer.queue.add('COLLECTION_RANKING_WARM',data,{jobId:id,priority:10});
  await layer.redis.set(`collectionPreparedSequence:${shop}:background-v2:old`,'old');
  await invalidate(shop);
  const queued=await layer.queue.getJob(id);
  assert.equal(queued.name,'COLLECTION_RANKING_WARM');assert.deepEqual(queued.data,data);
  assert.equal(await queued.getState(),'prioritized');
  assert.equal(await layer.redis.get(`collectionPreparedSequence:${shop}:background-v2:old`),null);
  let processed=false;
  layer.setHandler(async job=>{assert.equal(job.name,'COLLECTION_RANKING_WARM');assert.deepEqual(job.data,data);processed=true;});
  layer.worker.resume();await wait(()=>processed);await layer.worker.pause();
  results.push({name:'Configuration invalidation preserves real BullMQ job hash/name/data and job executes',passed:true});

  let finish,started=false;
  const spec={shop,collectionId:'1',revision:String(await layer.redis.get(configurationRevisionKey(shop))),query:{},orderedIds:['1','2']};
  const service=createCollectionPreparation({redis:layer.redis,queue:layer.queue,prepare:async()=>{started=true;return new Promise(resolve=>finish=resolve);}});
  layer.setHandler(job=>service.process(job.data));
  assert.equal((await service.get(spec)).status,'pending');layer.worker.resume();await wait(()=>started);
  await invalidate(shop,{kind:'products',collectionIds:['1']});
  await invalidate(shop,{kind:'products',collectionIds:['1']});
  finish({ids:['1','2'],metadata:{}});
  await wait(async()=>!!await layer.redis.get(preparationKey(spec)));await layer.worker.pause();
  assert.equal((await service.get(spec)).status,'ready');
  assert.equal(await layer.redis.get(productRevisionKey(shop,'1')),'2');
  assert.equal(await layer.redis.get(configurationRevisionKey(shop)),spec.revision);
  results.push({name:'Relevant updates during real queued scan permit publication without advancing configuration epoch',passed:true});

  // Remove the follow-up queued by the stale-data read; test a fresh configuration race.
  await layer.queue.drain(true);await invalidate(shop);started=false;
  const fresh={...spec,revision:String(await layer.redis.get(configurationRevisionKey(shop)))};
  await service.get(fresh);layer.worker.resume();await wait(()=>started);
  await invalidate(shop);finish({ids:['outdated-rule'],metadata:{}});
  await wait(async()=>!(await layer.queue.getJobCounts('active')).active);await layer.worker.pause();
  assert.equal(await layer.redis.get(preparationKey(fresh)),null);assert.deepEqual(layer.failures,[]);
  results.push({name:'Configuration change during real active job prevents outdated rule ranking publication',passed:true});

  await layer.reset();
  let builds=0;
  const stableSpec={...spec,revision:'0',retainForIdle:true,query:{filter:["shop = 'redis-regression.myshopify.com'"]}};
  const live=createCollectionPreparation({redis:layer.redis,queue:layer.queue,prepare:async()=>{builds++;return {ids:['1','2'],metadata:{}};}});
  layer.setHandler(job=>live.process(job.data));
  const requests=await Promise.all(Array.from({length:40},()=>live.get(stableSpec)));
  assert.ok(requests.every(r=>r.status==='pending'));
  const counts=await layer.queue.getJobCounts('prioritized');assert.equal(counts.prioritized,1);
  layer.worker.resume();await wait(async()=>!!await layer.redis.get(preparationKey(stableSpec)));await layer.worker.pause();assert.equal(builds,1);
  results.push({name:'40 concurrent cold visitors deduplicate to one real queued build',passed:true});

  await wait(async()=>!(await layer.queue.getJobCounts('active')).active);await layer.queue.drain(true);
  let clock=Date.now()+660000;
  const retained=createCollectionPreparation({redis:layer.redis,queue:layer.queue,retentionLimit:publicPreparationLimit,now:()=>clock,prepare:async()=>{builds++;return {ids:['1','2'],metadata:{}};}});
  assert.ok(await layer.redis.ttl(preparationKey(stableSpec))>85000);
  assert.equal((await retained.get(stableSpec)).status,'ready');assert.equal(builds,1);
  const refreshJobs=await layer.queue.getJobs(['prioritized']);assert.equal(refreshJobs.length,1);assert.equal(refreshJobs[0].opts.priority,10);
  layer.setHandler(job=>retained.process(job.data));layer.worker.resume();await wait(()=>builds===2);await wait(async()=>!(await layer.queue.getJobCounts('active')).active);await layer.worker.pause();
  assert.equal(JSON.parse(await layer.redis.get(preparationKey(stableSpec))).preparedAt,clock);
  results.push({name:'Real Redis retains day-long ranking through eleven-minute idle and refreshes with one low-priority job',passed:true});

  await layer.redis.incr(productRevisionKey(shop,'1'));clock+=660000;
  assert.equal((await retained.get(stableSpec)).status,'pending');
  const changed=await layer.queue.getJobs(['prioritized']);assert.equal(changed.length,1);assert.equal(changed[0].opts.priority,1);
  layer.worker.resume();await wait(()=>builds===3);await wait(async()=>!(await layer.queue.getJobCounts('active')).active);await layer.worker.pause();
  assert.equal((await retained.get(stableSpec)).status,'ready');
  results.push({name:'Known product changes older than freshness window require a fresh ranking despite day-long idle retention',passed:true});

  const budget=layer.physical(publicRetentionKey(shop));const unrelated=layer.physical('collectionRankingSession:'+shop+':protected');
  await layer.client.set(unrelated,'keep');await layer.client.zadd(budget,0,unrelated);
  for(let i=0;i<=publicPreparationLimit;i++){
    clock++;
    const different={...stableSpec,collectionId:'budget-'+i,orderRevision:'budget-'+i};await retained.process({key:preparationKey(different),spec:different});
  }
  assert.equal(await layer.client.zcard(budget),publicPreparationLimit);assert.equal(await layer.client.get(unrelated),'keep');
  assert.equal(await layer.redis.get(preparationKey({...stableSpec,collectionId:'budget-0',orderRevision:'budget-0'})),null);
  assert.ok(await layer.redis.get(preparationKey({...stableSpec,collectionId:'budget-'+publicPreparationLimit,orderRevision:'budget-'+publicPreparationLimit})));
  results.push({name:'Atomic retention cap bounds public order versions and cannot delete an injected protected session key',passed:true});

  const other={...stableSpec,collectionId:'budget-1',orderRevision:'budget-1'};
  const rotating={...stableSpec,collectionId:'budget-'+publicPreparationLimit,orderRevision:'budget-'+publicPreparationLimit};
  let previous=preparationKey(rotating);
  for(let i=0;i<publicPreparationLimit+2;i++){
    clock++;const changed={...rotating,orderRevision:'rotation-'+i};
    await retained.process({key:preparationKey(changed),spec:changed});
    assert.equal(await layer.redis.get(previous),null);previous=preparationKey(changed);
    assert.ok(await layer.redis.get(preparationKey(other)));
    assert.equal(await layer.client.zcard(budget),publicPreparationLimit);
  }
  results.push({name:'Repeated order refreshes replace only their own context without evicting other warm collections',passed:true});

  await layer.redis.del(preparationKey(stableSpec));await layer.queue.drain(true);
  let attempts=0;
  const retrying=createCollectionPreparation({redis:layer.redis,queue:layer.queue,prepare:async()=>{attempts++;if(attempts<3)throw Error('Isolated transient search failure');return {ids:['1','2'],metadata:{}};}});
  layer.setHandler(job=>retrying.process(job.data));
  await retrying.get(stableSpec);layer.worker.resume();await wait(async()=>!!await layer.redis.get(preparationKey(stableSpec)));await layer.worker.pause();
  assert.equal(attempts,3);assert.equal((await retrying.get(stableSpec)).status,'ready');
  assert.ok(layer.failures.every(f=>f.error==='Isolated transient search failure'));
  results.push({name:'Actual BullMQ exponential retries recover two transient search failures',passed:true});

  await layer.queue.drain(true);await layer.redis.del(preparationKey(stableSpec));
  await live.get(stableSpec);
  let childStarted=false;
  child=fork(new URL('./crash-worker.mjs',import.meta.url),[JSON.stringify({prefix:layer.prefix,name:layer.name,connection:layer.connection})],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
  child.on('message',message=>{if(message.started)childStarted=true;});
  await wait(()=>childStarted);child.kill();await new Promise(resolve=>child.once('exit',resolve));child=null;
  layer.setHandler(job=>live.process(job.data));layer.worker.resume();
  await wait(async()=>!!await layer.redis.get(preparationKey(stableSpec)));await layer.worker.pause();
  assert.equal((await live.get(stableSpec)).status,'ready');
  results.push({name:'Forcibly stopped worker leaves a recoverable stalled job which replacement worker completes',passed:true});

  const eviction=await layer.client.config('GET','maxmemory-policy');
  const environment={redisEvictionPolicy:eviction[1],workerCrashTestLockMs:3000,productionLockMs:30000};
  // Only report infrastructure; never alter shared Redis policy/configuration.
  await fs.writeFile('scratch/collection-redis-results.json',JSON.stringify({backend:'Real Redis/BullMQ',isolated:true,environment,results},null,2));
  console.log('REAL REDIS REGRESSIONS PASSED: '+results.length);
}finally{child?.kill();await layer.close();}
