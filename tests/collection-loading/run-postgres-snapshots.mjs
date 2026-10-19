// Disposable loopback cluster only; never reads DATABASE_URL or production data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawnSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createCollectionLoadingSnapshots} from '../../app/utils/collectionLoadingSnapshots.js';

const bin=process.env.POSTGRES_BIN||'C:/Program Files/PostgreSQL/18/bin';
const directory=fs.mkdtempSync(path.resolve('scratch','collection-snapshot-postgres-'));
const data=path.join(directory,'data');
const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const executable=name=>path.join(bin,name+(process.platform==='win32'?'.exe':''));
function run(name,args){
 const descriptor=name==='pg_ctl'?fs.openSync(path.join(directory,'control.log'),'a'):null;
 let result;try{result=spawnSync(executable(name),args,{windowsHide:true,encoding:'utf8',timeout:30000,...(descriptor==null?{}:{stdio:['ignore',descriptor,descriptor]})});}
 finally{if(descriptor!=null)fs.closeSync(descriptor);}
 if(result.status!==0)throw Error(name+' failed: '+(result.error?.message||'')+(result.stdout||'')+(result.stderr||'')+(descriptor==null?'':fs.readFileSync(path.join(directory,'control.log'),'utf8')));
 return result.stdout;
}
const sql=statement=>run('psql',['-h','127.0.0.1','-p',String(port),'-U','fixture','-d','postgres','-v','ON_ERROR_STOP=1','-c',statement]);
let started=false,database,second;const results=[];
const check=async(name,fn)=>{await fn();results.push(name);console.log('PASS '+name);};
try{
 run('initdb',['-D',data,'-U','fixture','--auth=trust','--encoding=UTF8','--locale=C']);
 try{run('pg_ctl',['-D',data,'-l',path.join(directory,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -F`,'-w','start']);}
 catch(error){
  if(!error.message.includes('could not create restricted token'))throw error;
  const descriptor=fs.openSync(path.join(directory,'server.log'),'a');
  const child=spawn(executable('postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-F'],{windowsHide:true,detached:true,stdio:['ignore',descriptor,descriptor]});child.unref();fs.closeSync(descriptor);
  let ready=false;for(let attempt=0;attempt<50;attempt++){try{sql('SELECT 1');ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,100));}}
  if(!ready)throw Error('Disposable PostgreSQL did not start');
 }
 started=true;
 const url=`postgresql://fixture@127.0.0.1:${port}/postgres`;
 const schema=fs.readFileSync('prisma/schema.prisma','utf8').replace('provider = "prisma-client-js"','provider = "prisma-client-js"\n  output = "./client"');
 fs.writeFileSync(path.join(directory,'schema.prisma'),schema);
 const generated=spawnSync(process.execPath,['node_modules/prisma/build/index.js','generate','--schema',path.join(directory,'schema.prisma')],{windowsHide:true,encoding:'utf8',timeout:60000,env:{...process.env,DATABASE_URL:url}});
 if(generated.status!==0)throw Error('Isolated Prisma client generation failed: '+(generated.error?.message||'')+(generated.stderr||''));
 const {PrismaClient}=await import(pathToFileURL(path.join(directory,'client','index.js')).href);
 database=new PrismaClient({datasources:{db:{url}}});second=new PrismaClient({datasources:{db:{url}}});
 const values=new Map(),redis={get:async key=>values.get(key),set:async(key,value,mode)=>{if(mode!=='NX'||!values.has(key))values.set(key,value);}};
 let clock=Date.now();const observed=[];
 const store=createCollectionLoadingSnapshots({database,redis,now:()=>clock,observe:error=>observed.push(error.name)});
 const shop='snapshot-fixture.myshopify.com',other='other-snapshot-fixture.myshopify.com';
 const key=(n,kind='cards',owner=shop)=>(kind==='cards'?`collectionFirstPage:${owner}:`:`collectionPreparedSequence:${owner}:background-v2:`)+String(n).padStart(64,'a');
 const write=(n,options={})=>store.save({shop,kind:'cards',key:key(n),collectionId:'1',payload:'fixture',expiresAt:clock+60000,...options});
 const load=(n,options={})=>store.load({shop,kind:'cards',key:key(n),...options});
 await check('missing PostgreSQL table is optional and preserves canonical fallback',async()=>{
  assert.equal(await write(1),false);assert.equal(await load(1),null);
 });
 run('psql',['-h','127.0.0.1','-p',String(port),'-U','fixture','-d','postgres','-v','ON_ERROR_STOP=1','-f','prisma/migrations/20261019000000_collection_loading_snapshots/migration.sql']);
 await check('actual migration creates the table and all expected indexes',async()=>{
  const indexes=await database.$queryRaw`SELECT indexname,indexdef FROM pg_indexes WHERE tablename='CollectionLoadingSnapshot'`;
  assert.equal(indexes.length,4);assert.ok(indexes.some(row=>row.indexdef.includes('USING gin (aliases)')));
 });
 await check('real Prisma Bytes, alias arrays, upsert and tenant isolation round trip',async()=>{
  assert.equal(await write(1,{aliases:[key(1),key(101)],payload:'first ✓'}),true);
  assert.equal(await load(101),'first ✓');assert.equal(await load(1,{shop:other}),null);
  assert.equal(await write(1,{payload:'replacement'}),true);assert.equal(await load(1),'replacement');assert.equal(await load(101),null);
  assert.equal(await write(2,{kind:'ranking',key:key(2,'ranking')}),true);
  assert.equal(await store.load({shop,kind:'ranking',key:key(2,'ranking')}),'fixture');
 });
 await check('older concurrent observations cannot replace a newer saved snapshot',async()=>{
  clock+=100;assert.equal(await write(1,{payload:'new',validatedAt:clock}),true);
  assert.equal(await write(1,{payload:'old',validatedAt:clock-1}),false);assert.equal(await load(1),'new');
 });
 await check('PostgreSQL advisory locks serialize concurrent cross-client budget decisions',async()=>{
  await database.collectionLoadingSnapshot.deleteMany();
  const options={redis,now:()=>clock,maxEntries:3,maxBytes:30,maxEntryBytes:10};
  const stores=[createCollectionLoadingSnapshots({database,...options}),createCollectionLoadingSnapshots({database:second,...options})];
  const writes=await Promise.all(Array.from({length:12},(_,n)=>stores[n%2].save({shop,kind:'cards',key:key(n+10),collectionId:'1',payload:'1234567890',expiresAt:clock+60000})));
  assert.ok(writes.every(Boolean));const usage=await database.collectionLoadingSnapshot.aggregate({_count:true,_sum:{size:true}});
  assert.equal(usage._count,3);assert.equal(usage._sum.size,30);
  const own=await database.collectionLoadingSnapshot.findFirst();assert.equal(await load(0,{key:own.id}),'1234567890');
 });
 await check('budgets and expiry cleanup only affect the current shop',async()=>{
  assert.equal(await store.save({shop:other,kind:'cards',key:key(1,'cards',other),collectionId:'1',payload:'protected',expiresAt:clock+120000}),true);
  clock+=60001;assert.equal(await load(10),null);assert.equal(await write(1),true);
  assert.equal(await database.collectionLoadingSnapshot.count({where:{shop}}),1);
  assert.equal(await database.collectionLoadingSnapshot.count({where:{shop:other}}),1);
 });
 await check('oversized entries, invalid keys and lost invalidation history are rejected',async()=>{
  const small=createCollectionLoadingSnapshots({database,redis,now:()=>clock,maxEntryBytes:3});
  assert.equal(await small.save({shop,kind:'cards',key:key(9),collectionId:'1',payload:'1234',expiresAt:clock+10000}),false);
  assert.equal(await write(9,{key:'foreign'}),false);
  values.delete(`collectionProductRevision:${shop}:1`);assert.equal(await load(1),null);
  assert.equal(await write(1),true);values.clear();assert.equal(await load(1),null);
 });
 await check('real PostgreSQL transaction rollback cannot leave a partial snapshot',async()=>{
  await database.$executeRawUnsafe('ALTER TABLE "CollectionLoadingSnapshot" ADD CONSTRAINT "fixture_reject" CHECK (size <> 7) NOT VALID');
  assert.equal(await write(90,{payload:'1234567'}),false);
  assert.equal(await database.collectionLoadingSnapshot.count({where:{id:key(90)}}),0);
  await database.$executeRawUnsafe('ALTER TABLE "CollectionLoadingSnapshot" DROP CONSTRAINT "fixture_reject"');
 });
 fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify({passed:results.length,results,loopbackOnly:true,productionAccess:false},null,2));
 console.log(`POSTGRES SNAPSHOT CHECKS PASSED: ${results.length}`);
}finally{
 await Promise.allSettled([database?.$disconnect(),second?.$disconnect()]);
 if(started){
  // Verify exact fixture identity before stopping this owned process.
  const identity=fs.readFileSync(path.join(data,'postmaster.pid'),'utf8').split(/\r?\n/);
  assert.equal(path.resolve(identity[1]),data);assert.equal(Number(identity[3]),port);
  run('pg_ctl',['-D',data,'-m','fast','-w','stop']);console.log('Disposable PostgreSQL stopped.');
 }
}
