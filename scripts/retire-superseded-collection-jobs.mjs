// Default is read-only. --apply removes only pending jobs with explicit proofs.
import Redis from 'ioredis';
import {Queue} from 'bullmq';
import {REDIS_URL} from '../app/services/redisConnection.server.js';
import {createCollectionWarmupScheduler} from '../app/utils/collectionWarmupScheduler.js';
import {supersededCollectionJob} from '../app/utils/supersededCollectionJob.js';
const args=process.argv.slice(2),shop=args[args.indexOf('--shop')+1];
if(!args.includes('--shop')||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||''))throw Error('Pass --shop store.myshopify.com');
const apply=args.includes('--apply'),redis=new Redis(REDIS_URL,{maxRetriesPerRequest:1,connectTimeout:5000,retryStrategy:()=>null});
redis.on('error',()=>{});const queue=new Queue('collectionRankingQueueV2',{connection:redis});
const out={shop,apply,examined:0,obsoleteConfiguration:0,legacyWarmups:0,removed:0,retained:0};
try{
 const revision=await redis.get('collectionPreparationRevision:'+shop)??'0';
 const prefix='bull:collectionRankingQueueV2';
 const ids=[...new Set([...await redis.lrange(prefix+':wait',0,-1),...await redis.zrange(prefix+':prioritized',0,-1),...await redis.zrange(prefix+':delayed',0,-1)])];
 let sweepConfirmed=false;
 for(const id of ids){
  const job=await queue.getJob(id);if(!job||job.data.shop!==shop)continue;out.examined++;
  const reason=supersededCollectionJob(job,shop,revision,await job.getState());
  const legacy=reason==='legacy-warmup',obsolete=reason==='obsolete-configuration';
  if(!legacy&&!obsolete){out.retained++;continue;}
  if(legacy)out.legacyWarmups++;if(obsolete)out.obsoleteConfiguration++;
  if(!apply)continue;
  if((await redis.get('collectionPreparationRevision:'+shop)??'0')!==revision)throw Error('Configuration changed during retirement; rerun with a fresh audit');
  if(legacy&&!sweepConfirmed){await createCollectionWarmupScheduler(queue)(shop);sweepConfirmed=true;}
  // A worker may claim the job after inspection. BullMQ refuses locked removal.
  if(!['waiting','prioritized','delayed'].includes(await job.getState())){out.retained++;continue;}
  try{await job.remove();out.removed++;}catch{out.retained++;}
 }
 console.log(JSON.stringify(out,null,2));
}finally{await queue.close();redis.disconnect();}
