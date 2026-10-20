import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionVisitorRefresh} from '../../app/utils/collectionVisitorRefresh.js';

function fixture(){
 const registered=[],added=[],jobs=new Map();let clock=700000;
 const queue={getJob:async id=>jobs.get(id),add:async(name,data,opts)=>{
  if(jobs.has(opts.jobId))return jobs.get(opts.jobId);
  const job={name,data,opts,state:'waiting',getState:async()=>job.state,changePriority:async({priority})=>{job.opts.priority=priority;},remove:async()=>jobs.delete(opts.jobId)};
  jobs.set(opts.jobId,job);added.push(job);return job;
 }};
 const shop='fixture.myshopify.com',request=new Request('https://api.test/api/filter?shop='+shop+'&country=IN&locale=en&collectionHandle=one&sortBy=best-selling&page=1&limit=25&responseProfile=collection-preview-v1');
 const input={request,entry:{shop,collectionId:'1',external:false},prepared:{preparedAt:clock,productRevision:'0',reusableDataRevision:'0:0'},state:{products:'0',globalProducts:'0'}};
 const run=createCollectionVisitorRefresh({queue,register:async(...args)=>registered.push(args),now:()=>clock});
 return {run,input,registered,added,jobs,advance:ms=>clock+=ms};
}
test('fresh saved-card hits record public visitor context without queuing unnecessary rebuilds',async()=>{
 const f=fixture();await f.run(f.input);assert.equal(f.registered.length,1);assert.equal(f.added.length,0);
});
test('aging or changed saved rankings schedule one canonical context ahead of the catalog backlog',async()=>{
 for(const reason of ['age','local','external']){
  const f=fixture();if(reason==='age')f.advance(480000);
  if(reason==='local')f.input.state.products='1';
  if(reason==='external'){f.input.entry.external=true;f.input.prepared.reusableDataRevision='0:0:0';f.input.state.globalProducts='1';}
  await Promise.all([f.run(f.input),f.run(f.input)]);
  assert.equal(f.added.length,1,reason);const job=f.added[0];
  assert.equal(job.name,'COLLECTION_RANKING_CATALOG');assert.equal(job.opts.priority,5);
  assert.equal(job.data.record.collectionId,'1');const url=new URL(job.data.record.url);
  assert.equal(url.searchParams.get('collectionId'),'1');assert.equal(url.searchParams.has('collectionHandle'),false);
  assert.equal(url.searchParams.has('responseProfile'),false);assert.equal(url.searchParams.get('country'),'IN');
 }
});
test('existing catalog jobs are promoted without duplication or demotion and active jobs are left alone',async()=>{
 const f=fixture();f.advance(480000);await f.run(f.input);const job=f.added[0];
 job.opts.priority=10;await f.run(f.input);assert.equal(job.opts.priority,5);assert.equal(f.added.length,1);
 job.opts.priority=1;await f.run(f.input);assert.equal(job.opts.priority,1);
 job.opts.priority=10;job.state='active';await f.run(f.input);assert.equal(job.opts.priority,10);
 job.state='completed';await f.run(f.input);assert.equal(f.added.length,2);
});
test('failed context cooldown is preserved and private/filtered/foreign URLs never enter the public queue',async()=>{
 const f=fixture();f.advance(480000);await f.run(f.input);const job=f.added[0];
 job.state='failed';job.finishedOn=1180000;await f.run(f.input);assert.equal(f.added.length,1);
 f.advance(60001);await f.run(f.input);assert.equal(f.added.length,2);
 for(const extra of ['customer_tags=VIP','option_Color=Red','page=2','shop=other.myshopify.com']){
  const isolated=fixture();isolated.advance(480000);isolated.input.request=new Request(isolated.input.request.url+'&'+extra);
  await isolated.run(isolated.input);assert.equal(isolated.added.length,0,extra);assert.equal(isolated.registered.length,0,extra);
 }
});
