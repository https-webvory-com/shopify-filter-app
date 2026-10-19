export async function processCollectionRankingJob(job, {prepare,warm,schedule}) {
  if(job.name==='COLLECTION_RANKING_PREPARE'){
    const result=await prepare(job.data);
    if(result.refreshRequired)await schedule(job.data.shop,[String(job.data.spec.collectionId||'all').split('/').pop()]);
    return result;
  }
  if(job.name==='COLLECTION_RANKING_WARM')return warm(job.data.shop,job.data.collectionIds);
  if(job.name==='COLLECTION_RANKING_CATALOG')return warm(job.data.shop,null,job.data.record);
  throw Error('Unknown collection ranking job');
}
