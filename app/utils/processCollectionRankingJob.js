const upgradedShops=new Set();
export async function processCollectionRankingJob(job, {prepare,warm,schedule,facts}) {
  if(['SEARCH_INDEX_BUILD','SEARCH_INDEX_PRODUCTS','SEARCH_INDEX_RETIRE'].includes(job.name))return (await import('../services/searchIndex.server.js')).processSearchIndexJob(job.data);
  if(job.name==='COLLECTION_FACTS_REFRESH')return facts(job.data);
  if(job.name==='COLLECTION_RANKING_PREPARE'){
    const result=await prepare(job.data);
    if(result.refreshRequired)await schedule(job.data.shop,[String(job.data.spec.collectionId||'all').split('/').pop()]);
    return result;
  }
  if(job.name==='COLLECTION_RANKING_WARM'){
    // Fold retained pre-upgrade scope batches into the bounded shop sweep.
    if(job.data.sweepVersion!==2){
      // All retained legacy batches predate this worker's upgrade. One global
      // sweep covers them; redispatching it for every old batch recreates the flood.
      if(!upgradedShops.has(job.data.shop)){
        await schedule(job.data.shop);upgradedShops.add(job.data.shop);
      }
      return {superseded:true};
    }
    return warm(job.data.shop,null);
  }
  if(job.name==='COLLECTION_RANKING_CATALOG')return warm(job.data.shop,null,job.data.record);
  throw Error('Unknown collection ranking job');
}
