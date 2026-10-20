export function supersededCollectionJob(job,shop,revision,state){
 if(job?.data?.shop!==shop||!['waiting','prioritized','delayed'].includes(state))return null;
 if(job.name==='COLLECTION_RANKING_WARM'&&job.data.sweepVersion!==2)return 'legacy-warmup';
 if(job.name==='COLLECTION_RANKING_PREPARE'&&typeof job.data.spec?.revision==='string'&&job.data.spec.revision!==revision)return 'obsolete-configuration';
 return null;
}
