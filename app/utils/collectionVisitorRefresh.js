import {createHash} from 'node:crypto';
import {normalizeCollectionWarmup,preparationFreshnessMs} from './collectionPreparation.js';

// Saved-card hits bypass the canonical ranker. Keep their visitor contexts in
// the registry and refresh changed/aging rankings before the next visit expires.
export function createCollectionVisitorRefresh({queue,register,now=Date.now}){
 return async function({request,entry,prepared,state}){
  const record=normalizeCollectionWarmup(entry.shop,request.url,entry.collectionId);
  if(!record)return;
  await register(entry.shop,request.url,entry.collectionId);
  const externalChanged=entry.external&&prepared.reusableDataRevision?.split(':')[2]!==state.globalProducts;
  if(prepared.productRevision===state.products&&!externalChanged&&
     Number.isFinite(prepared.preparedAt)&&now()-prepared.preparedAt<preparationFreshnessMs-120000)return;
  const priority=5,jobId='ranking-catalog-'+createHash('sha256').update(record.url).digest('hex');
  let job=await queue.getJob(jobId);
  if(job){
   const status=await job.getState();
   if(['waiting','active','prioritized','delayed'].includes(status)){
    if(status!=='active'&&(job.priority??job.opts?.priority??20)>priority)await job.changePriority({priority});
    return;
   }
   if(status==='failed'&&now()-(job.finishedOn??0)<60000)return;
   try{await job.remove();}catch{
    const replacement=await queue.getJob(jobId);
    if(replacement&&['waiting','active','prioritized','delayed'].includes(await replacement.getState()))return;
    throw Error('Collection visitor refresh could not replace completed job');
   }
  }
  // Same ID and one-context job as catalog preparation; no new queue or worker.
  await queue.add('COLLECTION_RANKING_CATALOG',{shop:entry.shop,record},{jobId,priority,attempts:5,backoff:{type:'exponential',delay:10000}});
 };
}
