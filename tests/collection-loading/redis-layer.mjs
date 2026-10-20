import Redis from 'ioredis';
import {Queue,Worker} from 'bullmq';
import {randomUUID} from 'node:crypto';

export async function createRedisTestLayer({workerOptions={},jobOptions={}}={}) {
  const prefix='cfp-isolated-'+randomUUID();
  const connection={host:process.env.TEST_REDIS_HOST||'184.72.37.227',port:Number(process.env.TEST_REDIS_PORT||6379),connectTimeout:5000,maxRetriesPerRequest:null};
  const client=new Redis({...connection,lazyConnect:true,retryStrategy:()=>null});client.on('error',()=>{});await client.connect();
  const name='ranking-tests';
  const queue=new Queue(name,{prefix,connection,defaultJobOptions:{attempts:3,backoff:{type:'exponential',delay:2000},removeOnComplete:true,removeOnFail:{count:50,age:3600},...jobOptions}});
  const physical=key=>prefix+':'+key;
  const evalArgs=(script,keyCount,...args)=>{
    const keys=args.slice(0,keyCount).map(physical),values=args.slice(keyCount);
    if(script.includes('ARGV[10]')){for(const index of [7,8,9])values[index]=physical(values[index]);}
    else if(script.includes('string.len(ARGV[6])'))values[5]=physical(values[5]);
    else if(!script.includes("redis.call('MGET',unpack(KEYS))"))values[4]=physical(values[4]);
    return [script,keyCount,...keys,...values];
  };
  const redis={
    get:async key=>{const value=await client.get(physical(key));return key.includes(':last-order-v1:')&&value?.startsWith(prefix+':')?value.slice(prefix.length+1):value;},
    hmget:(key,...fields)=>client.hmget(physical(key),...fields),
    set:(key,value,...args)=>client.set(physical(key),value,...args),mget:(...keys)=>client.mget(...keys.map(physical)),
    setex:(key,ttl,value)=>client.setex(physical(key),ttl,key.includes(':last-order-v1:')?physical(value):value),
    ttl:key=>client.ttl(physical(key)),incr:key=>client.incr(physical(key)),del:(...keys)=>keys.length?client.del(...keys.map(physical)):0,
    // The retention script takes its deletion prefix as its fifth value.
    // Keep both keys AND that prefix inside this test-owned namespace.
    eval:(...args)=>client.eval(...evalArgs(...args)),
    pipeline:()=>{const pipeline=client.pipeline();return {eval:(...args)=>pipeline.eval(...evalArgs(...args)),exec:()=>pipeline.exec()};},
    scan:async(cursor,_match,pattern,_count,count)=>{const [next,keys]=await client.scan(cursor,'MATCH',physical(pattern),'COUNT',count);return [next,keys.map(key=>key.slice(prefix.length+1))];},
  };
  let handler=async()=>{throw Error('Test worker handler not configured');};
  const failures=[];
  const worker=new Worker(name,job=>handler(job),{prefix,connection,concurrency:1,...workerOptions});
  worker.on('error',error=>failures.push({type:'worker',error:error.message}));
  worker.on('failed',(job,error)=>failures.push({type:'job',name:job?.name,error:error.message}));
  await Promise.all([queue.waitUntilReady(),worker.waitUntilReady()]);
  async function collectKeys(){let cursor='0';const keys=[];do{const [next,found]=await client.scan(cursor,'MATCH',prefix+':*','COUNT',200);cursor=next;keys.push(...found);}while(cursor!=='0');return [...new Set(keys)];}
  return {prefix,connection,name,redis,queue,worker,failures,client,physical,setHandler:fn=>handler=fn,
    async reset(){await worker.pause();await queue.drain(true);const keys=(await collectKeys()).filter(key=>!key.startsWith(prefix+':'+name+':'));if(keys.length)await client.del(...keys);failures.length=0;},
    async close(){await worker.close();await queue.close();const keys=await collectKeys();if(keys.some(key=>!key.startsWith(prefix+':')))throw Error('Unsafe Redis test cleanup');for(let i=0;i<keys.length;i+=100)await client.del(...keys.slice(i,i+100));const remaining=await collectKeys();await client.quit();if(remaining.length)throw Error('Redis test cleanup left temporary keys');},
  };
}
