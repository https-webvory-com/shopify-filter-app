import {Worker} from 'bullmq';
const options=JSON.parse(process.argv[2]);
if(!options.prefix?.startsWith('cfp-isolated-')||options.name!=='ranking-tests')throw Error('Refusing non-test queue');
const worker=new Worker(options.name,async job=>{
  process.send?.({started:true,name:job.name,id:job.id});
  await new Promise(()=>{}); // Parent forcibly exits this isolated worker mid-job.
},{connection:options.connection,prefix:options.prefix,lockDuration:3000,stalledInterval:1000,concurrency:1});
worker.on('error',error=>process.send?.({error:error.message}));
await worker.waitUntilReady();
