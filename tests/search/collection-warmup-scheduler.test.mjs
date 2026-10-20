import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionWarmupScheduler} from '../../app/utils/collectionWarmupScheduler.js';
import {processCollectionRankingJob} from '../../app/utils/processCollectionRankingJob.js';

function fixture(){
 const jobs=new Map(),added=[];
 const queue={getJob:async id=>jobs.get(id),add:async(name,data,opts)=>{
  if(jobs.has(opts.jobId))return jobs.get(opts.jobId);
  const job={name,data,opts,state:'delayed',getState:async()=>job.state,remove:async()=>jobs.delete(opts.jobId)};
  jobs.set(opts.jobId,job);added.push(job);return job;
 }};
 return {jobs,added,queue,schedule:createCollectionWarmupScheduler(queue)};
}

test('hundreds of different update batches coalesce into one shop sweep and retain tenant isolation',async()=>{
 const f=fixture();await Promise.all(Array.from({length:500},(_,i)=>f.schedule('one.myshopify.com',[String(i)])));
 assert.equal(f.added.length,1);assert.equal(f.added[0].data.collectionIds,null);assert.equal(f.added[0].opts.priority,5);
 await f.schedule('two.myshopify.com');assert.equal(f.added.length,2);
});

test('an update during an active sweep has one pending successor, even with concurrent producers',async()=>{
 const f=fixture();await f.schedule('one.myshopify.com');f.added[0].state='active';
 await Promise.all(Array.from({length:100},()=>f.schedule('one.myshopify.com')));
 assert.equal(f.added.length,2);assert.notEqual(f.added[0].opts.jobId,f.added[1].opts.jobId);
 f.added[0].state='completed';f.added[1].state='active';await f.schedule('one.myshopify.com');assert.equal(f.jobs.size,2);assert.equal(f.added.length,3);
});

test('claim between lookup and add cannot swallow an update into active work',async()=>{
 const f=fixture(),add=f.queue.add;let first=true;
 f.queue.add=async(...args)=>{const job=await add(...args);if(first){first=false;job.state='active';}return job;};
 await f.schedule('one.myshopify.com');assert.equal(f.added.length,2);assert.equal(f.added[1].state,'delayed');
});

test('a sweep that completes between lookup and add cannot swallow the new event',async()=>{
 const f=fixture(),add=f.queue.add;let first=true;
 f.queue.add=async(...args)=>{const job=await add(...args);if(first){first=false;job.state='completed';}return job;};
 await f.schedule('one.myshopify.com');assert.equal(f.added.length,2);
 assert.ok(f.added.some(job=>job.state==='delayed'));
});

test('completed and failed sweeps restart with bounded retries; Redis/queue errors remain visible',async()=>{
 for(const state of ['completed','failed']){
  const f=fixture();await f.schedule('one.myshopify.com');f.added[0].state=state;await f.schedule('one.myshopify.com');
  assert.equal(f.jobs.size,1);assert.equal(f.added.length,2);assert.equal(f.added[1].opts.attempts,5);
 }
 const f=fixture();f.queue.getJob=async()=>{throw Error('Redis unavailable');};await assert.rejects(f.schedule('one.myshopify.com'),/Redis unavailable/);
});

test('upgrade folds legacy scope batches into one sweep and new sweeps dispatch global dependencies',async()=>{
 const calls=[],handlers={schedule:async(...args)=>calls.push(['schedule',...args]),warm:async(...args)=>calls.push(['warm',...args])};
 await processCollectionRankingJob({name:'COLLECTION_RANKING_WARM',data:{shop:'one.myshopify.com',collectionIds:['1']}},handlers);
 await processCollectionRankingJob({name:'COLLECTION_RANKING_WARM',data:{shop:'one.myshopify.com',sweepVersion:2}},handlers);
 assert.deepEqual(calls,[['schedule','one.myshopify.com'],['warm','one.myshopify.com',null]]);
});
