// Real BullMQ lifecycle in a unique test namespace; no merchant jobs/cache keys.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';
import {createRedisTestLayer} from './redis-layer.mjs';
import * as lifecycle from '../../app/utils/collectionPreparation.js';
import {processCollectionRankingJob} from '../../app/utils/processCollectionRankingJob.js';

const layer=await createRedisTestLayer();
const wait=async(fn)=>{const until=Date.now()+30000;while(Date.now()<until){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Card preparation queue check timed out');};
const shop='card-retry-fixture.myshopify.com';
const record={url:`https://ranking.internal/api/filter?shop=${shop}&collectionId=1&country=US&locale=en&page=1`,collectionId:'1'};
let mode='recover',cardAttempts=0,completed=0,visitors=0;const failed=[];
try{
 await layer.worker.pause();
 const context={module:{exports:{}},exports:{},URL,Date,Request,Response,console:{info(){},error(){}},
  warmupLoader:async({context})=>{
   if(!context.rankingCardsPrecompute)return Response.json({warmup:true});
   cardAttempts++;
   if(mode==='permanent')throw Error('Fixture storage unavailable');
   const state=mode==='hit'?'hit':cardAttempts>=3?'stored':'miss';
   return Response.json({products:[]},{headers:{'X-CFP-Collection-Cards':state}});
  },require:name=>{
   if(name==='../utils/collectionPreparation.js')return lifecycle;
   if(name==='./redis.server.js')return {__esModule:true,default:layer.redis};
   if(name==='./queue.server.js')return {collectionRankingQueue:layer.queue};
   if(name==='../db.server.js')return {__esModule:true,default:{session:{findFirst:async()=>({id:'fixture'})}}};
   if(name==='../config/collection-prewarm.json')return {__esModule:true,default:[]};
   if(name==='node:crypto')return {createHash};
   return {__esModule:true,default:{}};
  }};
 const source=(await fs.readFile('app/services/collectionPreparation.server.js','utf8')).replace("await import('../routes/api.filter.jsx')",'({loader:warmupLoader})');
 vm.runInNewContext((await transform(source,{format:'cjs'})).code,context);
 const warm=context.module.exports.processCollectionWarmups;
 layer.setHandler(async job=>{
  if(job.name==='VISITOR_FIXTURE'){visitors++;return;}
  return processCollectionRankingJob(job,{warm});
 });
 layer.worker.on('completed',job=>{if(job.name==='COLLECTION_RANKING_CATALOG')completed++;});
 layer.worker.on('failed',(job,error)=>failed.push({id:job?.id,attempts:job?.attemptsMade,code:error.code}));
 const add=id=>layer.queue.add('COLLECTION_RANKING_CATALOG',{shop,record},{jobId:id,priority:10,attempts:5,backoff:{type:'exponential',delay:1000},removeOnComplete:false});
 const protectedKey='collectionRankingSession:'+shop+':protected';await layer.redis.set(protectedKey,'keep');
 const retry=await add('recover');layer.worker.resume();
 await wait(async()=>failed.length>=1&&await retry.getState()==='delayed');assert.equal(completed,0);
 await layer.queue.add('VISITOR_FIXTURE',{}, {priority:1});
 await wait(async()=>await retry.getState()==='completed');
 assert.equal(cardAttempts,3);assert.equal(completed,1);assert.equal(failed.filter(row=>row.id===retry.id).length,2);assert.equal(visitors,1);
 console.log('PASS real catalog worker retries card misses with backoff, yields to visitors, and only completes once cards are stored');

 mode='hit';cardAttempts=0;const ready=await add('existing');await wait(async()=>await ready.getState()==='completed');
 assert.equal(cardAttempts,1);assert.equal(completed,2);
 console.log('PASS validated existing cards complete without unnecessary preparation retries');

 mode='permanent';cardAttempts=0;const broken=await add('permanent');await wait(async()=>await broken.getState()==='failed');
 assert.equal(cardAttempts,5);assert.equal(completed,2);assert.equal((await layer.queue.getJob(broken.id)).attemptsMade,5);
 assert.equal(failed.filter(row=>row.id===broken.id).length,5);assert.equal(await layer.redis.get(protectedKey),'keep');
 console.log('PASS permanent card failures exhaust five attempts without false completion or deleting protected sessions');
 await fs.writeFile('scratch/card-preparation-real-queue-results.json',JSON.stringify({passed:3,namespace:layer.prefix,protectedSessionPreserved:true,actualService:true,productionJobsTouched:false},null,2));
}finally{await layer.close();}
