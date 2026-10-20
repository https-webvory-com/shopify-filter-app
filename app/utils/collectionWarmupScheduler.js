import {createHash} from 'node:crypto';

// One pending sweep per shop, regardless of the product-update batch's scopes.
// A second slot preserves events arriving while the first sweep is active.
// Global coverage is necessary: Include rules and pins can use outside products.
export function createCollectionWarmupScheduler(queue) {
 return async function schedule(shop) {
  const prefix='ranking-sweep-v2-'+createHash('sha256').update(shop).digest('hex');
  for(let attempt=0;attempt<4;attempt++)for(let slot=0;slot<2;slot++){
   const jobId=prefix+'-'+slot;
   let job=await queue.getJob(jobId);
   if(job){
    const state=await job.getState();
    if(state==='active')continue;
    if(['waiting','prioritized','delayed','waiting-children'].includes(state))return;
    if(['completed','failed'].includes(state)){
     try{await job.remove();}catch{
      // A concurrent producer may already have replaced this completed job.
      continue;
     }
    }
   }
   job=await queue.add('COLLECTION_RANKING_WARM',{shop,collectionIds:null,sweepVersion:2},
    {jobId,priority:5,delay:500,attempts:5,backoff:{type:'exponential',delay:10000}});
   // The worker can claim the job between getJob and add. In that case put
   // this event in the other slot, rather than silently merging into active work.
   if(['waiting','prioritized','delayed','waiting-children'].includes(await job.getState()))return;
  }
  throw Error('Collection warmup sweep could not be scheduled');
 };
}
