import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as lifecycle from '../../app/utils/collectionPreparation.js';
import {createHash} from 'node:crypto';

async function fixture() {
  const writes=[],records=[],shops=[],registries=[],jobs=new Map(),catalog=[],snapshots=new Map();let scans=0;
  const queue={getJob:async id=>jobs.get(id),add:async(name,data,options)=>{writes.push(['queue',name,data,options]);const job={getState:async()=> 'waiting'};jobs.set(options.jobId,job);return job;}};
  const redis={zrange:async()=>records,zrangebyscore:async()=>shops,zadd:async(...args)=>writes.push(['add',...args]),zremrangebyrank:async(...args)=>writes.push(['trim',...args]),zremrangebyscore:async(...args)=>writes.push(['prune',...args]),expire:async(...args)=>writes.push(['expire',...args])};
  redis.scan=async()=>{scans++;return ['0',registries];};redis.ttl=async()=>3600;
  redis.mget=async(...keys)=>keys.map(key=>snapshots.get(key)||null);
  const database={collection:{findMany:async options=>{
    if(options.distinct)return [...new Set(catalog.map(row=>row.shop))].map(shop=>({shop}));
    const rows=catalog.filter(row=>row.shop===options.where.shop).sort((a,b)=>a.id.localeCompare(b.id));
    const offset=options.cursor?rows.findIndex(row=>row.id===options.cursor.id)+1:0;
    return rows.slice(offset,offset+options.take).map(({id})=>({id}));
  }}};
  const ctx={module:{exports:{}},exports:{},URL,Date,Request,Response,warmupLoader:async({request})=>{writes.push(['load',request.url]);return Response.json({warmup:true});},require:name=>{
    if(name==='../utils/collectionPreparation.js')return lifecycle;
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
  return {...ctx.module.exports,writes,records,shops,jobs,registries,catalog,snapshots,scans:()=>scans};
}

test('warmup registry stores a normalized public collection context with a bounded size and lifetime',async()=>{
  const f=await fixture();await f.registerCollectionWarmup('fixture.myshopify.com','https://foreign.example/api/filter?shop=fixture.myshopify.com&collectionHandle=hydrogen&locale=en&country=US&page=1&limit=48');
  const url=new URL(JSON.parse(f.writes[0][3]).url);assert.equal(url.origin,'https://ranking.internal');assert.equal(url.searchParams.get('limit'),'25');
  assert.equal(url.searchParams.get('shop'),'fixture.myshopify.com');assert.equal(url.searchParams.get('country'),'US');
  assert.deepEqual(Array.from(f.writes[1].slice(2)),[0,-21]);assert.equal(f.writes[2][2],86400);
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
  assert.ok(Math.abs(registration[3]-(Date.now()-23*3600000))<1000);
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
  assert.deepEqual(f.writes,[['load',url]]);
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
