import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as lifecycle from '../../app/utils/collectionPreparation.js';
import {createHash} from 'node:crypto';
import {processCollectionRankingJob} from '../../app/utils/processCollectionRankingJob.js';

async function fixture() {
  const writes=[],records=[],shops=[],registries=[],jobs=new Map(),catalog=[],snapshots=new Map(),seeds=[];let scans=0;
  const queue={getJob:async id=>jobs.get(id),add:async(name,data,options)=>{writes.push(['queue',name,data,options]);const job={getState:async()=> 'waiting'};jobs.set(options.jobId,job);return job;}};
  const redis={zrange:async()=>records,zrangebyscore:async()=>shops,zadd:async(...args)=>writes.push(['add',...args]),zremrangebyrank:async(...args)=>writes.push(['trim',...args]),zremrangebyscore:async(...args)=>writes.push(['prune',...args]),expire:async(...args)=>writes.push(['expire',...args])};
  redis.scan=async()=>{scans++;return ['0',registries];};redis.ttl=async()=>3600;
  redis.mget=async(...keys)=>keys.map(key=>snapshots.get(key)||null);
  const offline=new Set();
  const database={session:{findFirst:async({where})=>offline.has(where.shop)?null:{id:'offline_'+where.shop}},collection:{findMany:async options=>{
    if(options.distinct)return [...new Set(catalog.map(row=>row.shop))].map(shop=>({shop}));
    const rows=catalog.filter(row=>row.shop===options.where.shop).sort((a,b)=>a.id.localeCompare(b.id));
    const offset=options.cursor?rows.findIndex(row=>row.id===options.cursor.id)+1:0;
    return rows.slice(offset,offset+options.take).map(({id})=>({id}));
  }}};
  const ctx={module:{exports:{}},exports:{},URL,Date,Request,Response,warmupLoader:async({request})=>{writes.push(['load',request.url]);return Response.json({warmup:true});},require:name=>{
    if(name==='../utils/collectionPreparation.js')return lifecycle;
    if(name==='./collectionRuleFacts.server.js')return {prepareCollectionFromFacts:async()=>null,scheduleCollectionFactRefresh:async()=>{}};
    if(name==='../config/collection-prewarm.json')return {__esModule:true,default:seeds};
    if(name==='../utils/prepareCollectionRanking.js')return {prepareCollectionRanking:()=>{throw Error('Unexpected preparation');}};
    if(name==='./redis.server.js')return {__esModule:true,default:redis};
    if(name==='./queue.server.js')return {collectionRankingQueue:queue};
    if(name==='../db.server.js')return {__esModule:true,default:database};
    if(name==='./collectionBestSelling.server.js')return {
      collectionOrderSnapshotKey:(shop,id)=>`collectionOrderSnapshot:${shop}:${id}`,
      getCollectionBestSellingState:async(shop,id,options)=>{writes.push(['order',shop,id,options]);return {status:'pending'};},
    };
    if(name==='node:crypto')return {createHash};
    return {__esModule:true,default:{}};
  }};
  const source=(await fs.readFile('app/services/collectionPreparation.server.js','utf8')).replace("await import('../routes/api.filter.jsx')",'({loader:warmupLoader})');
  vm.runInNewContext((await transform(source,{format:'cjs'})).code,ctx);
  return {...ctx.module.exports,writes,records,shops,jobs,registries,catalog,snapshots,seeds,offline,scans:()=>scans};
}

test('warmup registry stores a normalized public collection context with a bounded size and lifetime',async()=>{
  const f=await fixture();await f.registerCollectionWarmup('fixture.myshopify.com','https://foreign.example/api/filter?shop=fixture.myshopify.com&collectionHandle=hydrogen&locale=en&country=US&page=1&limit=48');
  const url=new URL(JSON.parse(f.writes[0][3]).url);assert.equal(url.origin,'https://ranking.internal');assert.equal(url.searchParams.get('limit'),'25');
  assert.equal(url.searchParams.get('shop'),'fixture.myshopify.com');assert.equal(url.searchParams.get('country'),'US');
  assert.deepEqual(Array.from(f.writes[1].slice(2)),[0,-41]);assert.equal(f.writes[2][2],lifecycle.warmupRegistryLifetime);
  assert.equal(f.writes[3][1],lifecycle.warmupShopsKey);assert.equal(f.writes[3][3],'fixture.myshopify.com');
  assert.equal(f.writes[4][0],'prune');
});

test('periodic warmup schedules known public shops at low priority and deduplicates repeated ticks',async()=>{
  const f=await fixture();f.shops.push('fixture.myshopify.com','invalid shop','other.myshopify.com');
  await f.scheduleRegisteredCollectionWarmups();await f.scheduleRegisteredCollectionWarmups();
  const queued=f.writes.filter(w=>w[0]==='queue');assert.equal(queued.length,2);
  assert.deepEqual(queued.map(w=>w[2].shop),['fixture.myshopify.com','other.myshopify.com']);
  for(const q of queued){assert.equal(q[3].priority,10);assert.equal(q[3].delay,500);assert.equal(q[2].collectionIds,null);}
});

test('worker startup discovers old public registries once without extending idle lifetime or replacing a fresh registration',async()=>{
  const f=await fixture();f.registries.push('collectionWarmupContextsV2:fixture.myshopify.com','collectionWarmupContextsV2:invalid shop');
  await f.scheduleRegisteredCollectionWarmups();await f.scheduleRegisteredCollectionWarmups();
  assert.equal(f.scans(),1);
  const registration=f.writes.find(w=>w[0]==='add');
  assert.equal(registration[1],lifecycle.warmupShopsKey);assert.equal(registration[2],'NX');
  assert.ok(Math.abs(registration[3]-(Date.now()-(lifecycle.warmupRegistryLifetime-3600)*1000))<1000);
  assert.equal(registration[4],'fixture.myshopify.com');
  assert.equal(f.writes.filter(w=>w[0]==='add').length,1);
});

test('customer-targeted, filtered, token and later-page requests are never replayed as anonymous warmups',async()=>{
  for(const extra of ['customer_tags=VIP','customerTags=VIP','options[Color][]=Blue','vendor[]=Vendor','rankingToken=token','q=dress','page=2']){
    const f=await fixture();await f.registerCollectionWarmup('fixture.myshopify.com','https://fixture/api/filter?shop=fixture.myshopify.com&collectionHandle=hydrogen&page=1&'+extra);
    assert.equal(f.writes.length,0,extra);
  }
});

test('a warmup cannot register another shop request under this shop',async()=>{
  const f=await fixture();await f.registerCollectionWarmup('fixture.myshopify.com','https://fixture/api/filter?shop=other.myshopify.com&collectionHandle=hydrogen&page=1');
  assert.equal(f.writes.length,0);
});

test('corrupt or private warmup records do not stop valid matching collection warmups',async()=>{
  const f=await fixture();const url='https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionHandle=hydrogen&page=1';
  f.records.push('{bad',JSON.stringify({url:'invalid',collectionId:'1'}),JSON.stringify({url:url+'&customer_tags=VIP',collectionId:'1'}),JSON.stringify({url,collectionId:'2'}),JSON.stringify({url,collectionId:'1'}));
  await f.processCollectionWarmups('fixture.myshopify.com',['1']);
  assert.equal(f.writes.length,1);const normalized=new URL(f.writes[0][1]);assert.equal(normalized.searchParams.get('collectionId'),'1');assert.equal(normalized.searchParams.has('collectionHandle'),false);
});

test('collections with no previous visitor seed missing order snapshots in bounded tenant-scoped pages',async()=>{
 const f=await fixture();
 for(let i=0;i<205;i++)f.catalog.push({shop:'fixture.myshopify.com',id:'gid://shopify/Collection/'+String(i).padStart(4,'0')});
 f.catalog.push({shop:'other.myshopify.com',id:'gid://shopify/Collection/other'});
 for(const row of f.catalog.filter(row=>row.shop==='fixture.myshopify.com').slice(0,3))f.snapshots.set(`collectionOrderSnapshot:${row.shop}:${row.id}`,'existing snapshot');
 await f.scheduleMissingCollectionOrders('fixture.myshopify.com');
 const orders=f.writes.filter(row=>row[0]==='order');assert.equal(orders.length,202);
 assert.equal(new Set(orders.map(row=>row[2])).size,202);
 assert.ok(orders.every(row=>row[1]==='fixture.myshopify.com'&&row[3].warmup===true));
 assert.equal(f.snapshots.size,3);
});

test('startup discovers catalog shops even without a visitor-created registry',async()=>{
 const f=await fixture();f.catalog.push({shop:'new.myshopify.com',id:'gid://shopify/Collection/1'},{shop:'invalid shop',id:'2'});
 await f.scheduleRegisteredCollectionWarmups();
 const queued=f.writes.filter(row=>row[0]==='queue');assert.equal(queued.length,1);assert.equal(queued[0][2].shop,'new.myshopify.com');
 const orders=f.writes.filter(row=>row[0]==='order');assert.equal(orders.length,1);assert.equal(orders[0][1],'new.myshopify.com');
});

test('frequent public warmup ticks do not repeatedly scan the catalog for missing orders',async()=>{
 const f=await fixture();f.catalog.push({shop:'fixture.myshopify.com',id:'1'});
 await f.scheduleRegisteredCollectionWarmups();await f.scheduleRegisteredCollectionWarmups();
 assert.equal(f.writes.filter(row=>row[0]==='order').length,1);
});

test('configured public priorities warm before any visitor registry and reserve the existing storage budget',async()=>{
 const f=await fixture();f.seeds.push({shop:'new.myshopify.com',collectionHandle:'petite',country:'IN',locale:'en',sortBy:'best-selling'});
 await f.scheduleRegisteredCollectionWarmups();assert.equal(f.writes.find(w=>w[0]==='queue')[2].shop,'new.myshopify.com');
 await f.processCollectionWarmups('new.myshopify.com');
 const loads=f.writes.filter(w=>w[0]==='load');assert.equal(loads.length,1);const url=new URL(loads[0][1]);assert.equal(url.searchParams.get('country'),'IN');assert.equal(url.searchParams.get('locale'),'en');assert.equal(url.searchParams.get('collectionHandle'),'petite');
 await f.registerCollectionWarmup('new.myshopify.com','https://app/api/filter?shop=new.myshopify.com&collectionHandle=other&page=1');assert.equal(f.writes.find(w=>w[0]==='trim')[3],-40);
});
test('handle, ID, page-size and transport aliases share a warmup context without crossing markets',()=>{
 const base='https://app/api/filter?shop=fixture.myshopify.com&collectionHandle=petite&country=IN&locale=en&page=1&sortBy=bestselling';
 const first=lifecycle.normalizeCollectionWarmup('fixture.myshopify.com',base+'&limit=50&responseProfile=collection-v2','gid://shopify/Collection/123');
 const second=lifecycle.normalizeCollectionWarmup('fixture.myshopify.com',base.replace('collectionHandle=petite','collectionId=123').replace('bestselling','best-selling')+'&limit=25&responseProfile=collection-v1','123');
 assert.deepEqual(first,second);assert.equal(new URL(first.url).searchParams.has('responseProfile'),false);
 assert.notEqual(lifecycle.normalizeCollectionWarmup('fixture.myshopify.com',base.replace('country=IN','country=US'),'123').url,first.url);
});
test('legacy duplicate warmup records replay only one canonical preparation',async()=>{
 const f=await fixture(),base='https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionHandle=petite&country=IN&locale=en&page=1';
 for(const version of ['collection-v1','collection-v2'])f.records.push(JSON.stringify({url:base+'&responseProfile='+version,collectionId:'123'}));
 await f.processCollectionWarmups('fixture.myshopify.com');assert.equal(f.writes.filter(w=>w[0]==='load').length,1);
});

test('catalog preparation covers unseen collections in public markets, with individual low priority deduplicated jobs',async()=>{
 const f=await fixture();f.seeds.push({shop:'fixture.myshopify.com',collectionHandle:'seed',country:'IN',locale:'en'});
 for(let i=0;i<205;i++)f.catalog.push({shop:'fixture.myshopify.com',id:'gid://shopify/Collection/'+String(i).padStart(4,'0')});
 f.catalog.push({shop:'other.myshopify.com',id:'gid://shopify/Collection/9999'});
 f.records.push(JSON.stringify({url:'https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=1&country=US&locale=en&page=1',collectionId:'1'}));
 f.records.push(JSON.stringify({url:'https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=2&country=CA&page=1&customerTags=VIP',collectionId:'2'}));
 await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');
 const jobs=f.writes.filter(w=>w[0]==='queue');assert.equal(jobs.length,410);
 assert.equal(new Set(jobs.map(w=>w[3].jobId)).size,410);
 for(const job of jobs){assert.equal(job[1],'COLLECTION_RANKING_CATALOG');assert.equal(job[3].priority,20);
  const url=new URL(job[2].record.url);assert.equal(url.origin,'https://ranking.internal');assert.equal(url.searchParams.get('shop'),'fixture.myshopify.com');
  assert.ok(['IN','US'].includes(url.searchParams.get('country')));assert.equal(url.searchParams.get('sortBy'),'best-selling');}
 await f.processCollectionWarmups('fixture.myshopify.com',null,jobs[0][2].record);
 assert.equal(f.writes.filter(w=>w[0]==='load').length,1);
});

test('catalog preparation caps markets and never invents a public context without an observed or configured market',async()=>{
 const f=await fixture();f.catalog.push({shop:'fixture.myshopify.com',id:'123'});
 await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');assert.equal(f.writes.length,0);
 for(const country of ['IN','US','CA','AU','GB','FR'])f.records.push(JSON.stringify({url:`https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=1&country=${country}&locale=en&page=1`,collectionId:'1'}));
 await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');assert.equal(f.writes.filter(w=>w[0]==='queue').length,4);
});

test('catalog jobs dispatch exactly their public context through the existing ranking worker lane',async()=>{
 const calls=[],record={url:'https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=123&page=1',collectionId:'123'};
 await processCollectionRankingJob({name:'COLLECTION_RANKING_CATALOG',data:{shop:'fixture.myshopify.com',record}},
  {warm:async(...args)=>calls.push(args),prepare:()=>{throw Error('Unexpected preparation');}});
 assert.deepEqual(calls,[['fixture.myshopify.com',null,record]]);
});

test('disconnected shops do not enqueue order/catalog work or replay already queued catalog requests',async()=>{
 const f=await fixture();f.offline.add('fixture.myshopify.com');f.catalog.push({shop:'fixture.myshopify.com',id:'1'});
 f.seeds.push({shop:'fixture.myshopify.com',collectionHandle:'seed',country:'IN',locale:'en'});
 await f.scheduleRegisteredCollectionWarmups();assert.equal(f.writes.filter(w=>['queue','order','load'].includes(w[0])).length,0);
 const result=await f.processCollectionWarmups('fixture.myshopify.com',null,{url:'https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=1&page=1',collectionId:'1'});
 assert.equal(result.skipped,true);assert.equal(f.writes.filter(w=>w[0]==='load').length,0);
});
