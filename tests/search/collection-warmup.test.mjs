import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as lifecycle from '../../app/utils/collectionPreparation.js';
import {createHash} from 'node:crypto';
import {processCollectionRankingJob} from '../../app/utils/processCollectionRankingJob.js';
import {createCollectionVisitorRefresh} from '../../app/utils/collectionVisitorRefresh.js';
import {createCollectionWarmupScheduler} from '../../app/utils/collectionWarmupScheduler.js';
import {createCollectionDependencies} from '../../app/utils/collectionDependencies.js';
import {createCollectionSalesDependencies} from '../../app/utils/collectionSalesDependencies.js';
import {createCollectionHeadProofs} from '../../app/utils/collectionHeadProofs.js';
import {createCollectionPreparationTelemetry} from '../../app/utils/collectionPreparationTelemetry.js';
import {publishedCollectionKey} from '../../app/utils/collectionPublishedPage.js';
import {catalogPublicationInvalidatedAtKey,configurationInvalidatedAtKey,marketRuleInvalidatedAtKey} from '../../app/utils/shopCacheInvalidation.js';

async function fixture() {
  const writes=[],records=[],shops=[],registries=[],jobs=new Map(),catalog=[],snapshots=new Map(),seeds=[],schedules=[],published=[],connections=new Map(),primaryMarket={value:null};let scans=0;
  const queue={getJob:async id=>jobs.get(id),add:async(name,data,options)=>{writes.push(['queue',name,data,options]);const job={opts:options,getState:async()=> 'waiting',changePriority:async({priority})=>{job.opts.priority=priority;writes.push(['priority',options.jobId,priority]);}};jobs.set(options.jobId,job);return job;}};
  const redis={zrange:async()=>records,zrangebyscore:async()=>shops,zadd:async(...args)=>writes.push(['add',...args]),zremrangebyrank:async(...args)=>writes.push(['trim',...args]),zremrangebyscore:async(...args)=>writes.push(['prune',...args]),expire:async(...args)=>writes.push(['expire',...args])};
  redis.scan=async()=>{scans++;return ['0',registries];};redis.ttl=async()=>3600;
  redis.get=async key=>snapshots.get(key)||null;
  redis.setex=async(key,_seconds,value)=>{snapshots.set(key,value);};
  redis.mget=async(...keys)=>keys.map(key=>snapshots.get(key)||null);
  const offline=new Set();
  const database={collectionLoadingSnapshot:{findMany:async()=>published},marketStorefrontConnection:{findUnique:async({where})=>connections.get(where.shop)||null},merchandisingRule:{findMany:async()=>schedules},session:{findFirst:async({where})=>offline.has(where.shop)?null:{id:'offline_'+where.shop}},collection:{findMany:async options=>{
    if(options.distinct)return [...new Set(catalog.map(row=>row.shop))].map(shop=>({shop}));
    const rows=catalog.filter(row=>row.shop===options.where.shop&&(!options.where.id?.in||options.where.id.in.includes(row.id))).sort((a,b)=>a.id.localeCompare(b.id));
    const offset=options.cursor?rows.findIndex(row=>row.id===options.cursor.id)+1:0;
    return rows.slice(offset,offset+options.take).map(({id})=>({id}));
  }}};
  let publishedReady=false,cardProbe=()=>publishedReady?new Response(null,{headers:{'X-CFP-Collection-Cards':'published'}}):null,marketState={status:'disabled',version:null},loadingResponse=(_request,context)=>context?.rankingCardsPrecompute?Response.json({products:[]},{headers:{'X-CFP-Collection-Cards':'stored'}}):Response.json({warmup:true});
  const ctx={module:{exports:{}},exports:{},URL,Date,Request,Response,console,primaryMarket,warmupLoader:async({request,context})=>{writes.push(['load',request.url,context]);const response=loadingResponse(request,context);if(context?.rankingCardsPrecompute&&response.status===200&&['stored','published'].includes(response.headers.get('X-CFP-Collection-Cards')))publishedReady=true;return response;},require:name=>{
    if(name==='../utils/collectionPreparation.js')return lifecycle;
    if(name==='../utils/collectionVisitorRefresh.js')return {createCollectionVisitorRefresh};
    if(name==='../utils/collectionWarmupScheduler.js')return {createCollectionWarmupScheduler};
    if(name==='../utils/collectionDependencies.js')return {createCollectionDependencies};
    if(name==='../utils/collectionSalesDependencies.js')return {createCollectionSalesDependencies};
    if(name==='../utils/collectionHeadProofs.js')return {createCollectionHeadProofs};
    if(name==='../utils/collectionPreparationTelemetry.js')return {createCollectionPreparationTelemetry};
    if(name==='../utils/collectionPublishedPage.js')return {publishedCollectionKey};
    if(name==='../utils/shopCacheInvalidation.js')return {catalogPublicationInvalidatedAtKey,configurationInvalidatedAtKey,marketRuleInvalidatedAtKey};
    if(name==='./collectionRuleFacts.server.js')return {prepareCollectionFromFacts:async()=>null,scheduleCollectionFactRefresh:async()=>{}};
    if(name==='../config/collection-prewarm.json')return {__esModule:true,default:seeds};
    if(name==='../utils/prepareCollectionRanking.js')return {prepareCollectionRanking:()=>{throw Error('Unexpected preparation');}};
    if(name==='./redis.server.js')return {__esModule:true,default:redis};
    if(name==='./queue.server.js')return {collectionRankingQueue:queue};
    if(name==='./collectionCards.server.js')return {getPreparedCollectionCards:async(request,options)=>{writes.push(['probe',request.url,options]);return cardProbe(request,options);}};
    if(name==='./marketAvailability.server.js')return {getMarketAvailabilityState:async()=>marketState};
    if(name==='../db.server.js')return {__esModule:true,default:database};
    if(name==='./collectionBestSelling.server.js')return {
      collectionOrderSnapshotKey:(shop,id)=>`collectionOrderSnapshot:${shop}:${id}`,
      getCollectionBestSellingState:async(shop,id,options)=>{writes.push(['order',shop,id,options]);return {status:'pending'};},
    };
    if(name==='node:crypto')return {createHash};
    return {__esModule:true,default:{}};
  }};
  const source=(await fs.readFile('app/services/collectionPreparation.server.js','utf8')).replace("await import('../routes/api.filter.jsx')",'({loader:warmupLoader})').replace("await import('../shopify.server.js')",'({unauthenticated:{admin:async()=>({admin:{graphql:async()=>Response.json({data:{shop:primaryMarket.value}})}})}})');
  vm.runInNewContext((await transform(source,{format:'cjs'})).code,ctx);
  return {...ctx.module.exports,writes,records,shops,jobs,registries,catalog,snapshots,seeds,schedules,published,connections,offline,scans:()=>scans,setResponse:fn=>loadingResponse=fn,setProbe:fn=>cardProbe=(...args)=>publishedReady?new Response(null,{headers:{'X-CFP-Collection-Cards':'published'}}):fn(...args),resetPublished:()=>{publishedReady=false;},setMarket:value=>marketState=value,setPrimary:value=>primaryMarket.value=value};
}

test('head versions cover rules, pins, market, stock revisions, schedules and native order without reading a full ranking',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com',spec={shop,collectionId:'gid://shopify/Collection/123',revision:'3',needsShopifyOrder:true,orderRevision:'native-1',sortBy:'best-selling',query:{country:'IN',locale:'en'},pinnedIds:['1','2','3','4','5']};
 for(const [key,value]of [[`collectionPreparationRevision:${shop}`,'3'],[`collectionRankingDataRevision:${shop}:all`,'0'],[`collectionRankingDataRevision:${shop}:123`,'0'],[`collectionLoadingGeneration:${shop}`,'generation'],[`collectionOrderSnapshot:${shop}:gid://shopify/Collection/123`,JSON.stringify({revision:'native-1',ids:[]})]])f.snapshots.set(key,value);
 const baseline=await f.getCollectionHeadVersion(spec);assert.match(baseline,/^[a-f0-9]{64}$/);
 for(const other of [{...spec,pinnedIds:['9']},{...spec,rule:{conditions:[{action:'Boost',field:'Tags',value:'New'}]}},{...spec,query:{country:'US',locale:'en'}}])assert.notEqual(await f.getCollectionHeadVersion(other),baseline);
 f.snapshots.set(`collectionProductContentRevision:${shop}:all`,'1');assert.notEqual(await f.getCollectionHeadVersion(spec),baseline);f.snapshots.delete(`collectionProductContentRevision:${shop}:all`);
 f.schedules.push({id:'scheduled',startDate:new Date(Date.now()+60000),endDate:null});assert.notEqual(await f.getCollectionHeadVersion(spec),baseline);f.schedules.length=0;
 f.snapshots.set(`collectionPreparationRevision:${shop}`,'4');assert.equal(await f.getCollectionHeadVersion(spec),null);f.snapshots.set(`collectionPreparationRevision:${shop}`,'3');
 f.snapshots.set(`collectionOrderSnapshot:${shop}:gid://shopify/Collection/123`,JSON.stringify({revision:'native-2',ids:[]}));assert.equal(await f.getCollectionHeadVersion(spec),null);
 const priceSpec={...spec,sortBy:'price-descending',needsShopifyOrder:false,orderRevision:null};
 const priceVersion=await f.getCollectionHeadVersion(priceSpec);assert.match(priceVersion,/^[a-f0-9]{64}$/);
 f.snapshots.set(`collectionOrderSnapshot:${shop}:gid://shopify/Collection/123`,'obsolete native order');
 assert.equal(await f.getCollectionHeadVersion(priceSpec),priceVersion,'price pins do not depend on the native best-selling snapshot');
 assert.equal(f.writes.length,0);assert.equal(f.scans(),0);
});

test('warmup registry stores a normalized public collection context with a bounded size and lifetime',async()=>{
  const f=await fixture();await f.registerCollectionWarmup('fixture.myshopify.com','https://foreign.example/api/filter?shop=fixture.myshopify.com&collectionHandle=hydrogen&locale=en&country=US&page=1&limit=48');
  const url=new URL(JSON.parse(f.writes[0][3]).url);assert.equal(url.origin,'https://ranking.internal');assert.equal(url.searchParams.get('limit'),'25');
  assert.equal(url.searchParams.get('shop'),'fixture.myshopify.com');assert.equal(url.searchParams.get('country'),'US');
  assert.deepEqual(Array.from(f.writes[1].slice(2)),[0,-41]);assert.equal(f.writes[2][2],lifecycle.warmupRegistryLifetime);
  assert.equal(f.writes[3][1],lifecycle.warmupShopsKey);assert.equal(f.writes[3][3],'fixture.myshopify.com');
  assert.equal(f.writes[4][0],'prune');
});

test('production saved-card visit hook records its market and queues one promoted context without scanning the catalog',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 const request=new Request('https://api.test/api/filter?shop='+shop+'&collectionHandle=one&country=IN&locale=en&page=1&limit=25&responseProfile=collection-preview-v1');
 const visit={request,entry:{shop,collectionId:'1',external:false},prepared:{preparedAt:Date.now(),productRevision:'0'},state:{products:'1',globalProducts:'0'}};
 await f.registerCollectionCardVisit(visit);await f.registerCollectionCardVisit(visit);
 const jobs=f.writes.filter(w=>w[0]==='queue');assert.equal(jobs.length,1);assert.equal(jobs[0][1],'COLLECTION_RANKING_CATALOG');assert.equal(jobs[0][3].priority,1);
 assert.equal(jobs[0][2].record.collectionId,'1');assert.equal(new URL(jobs[0][2].record.url).searchParams.get('country'),'IN');
 assert.equal(f.writes.filter(w=>w[0]==='load').length,0);assert.ok(f.writes.some(w=>w[0]==='add'));
});

test('periodic warmup schedules known public shops at low priority and deduplicates repeated ticks',async()=>{
  const f=await fixture();f.shops.push('fixture.myshopify.com','invalid shop','other.myshopify.com');
  await f.scheduleRegisteredCollectionWarmups();await f.scheduleRegisteredCollectionWarmups();
  const queued=f.writes.filter(w=>w[0]==='queue');assert.equal(queued.length,2);
  assert.deepEqual(queued.map(w=>w[2].shop),['fixture.myshopify.com','other.myshopify.com']);
  for(const q of queued){assert.equal(q[3].priority,5);assert.equal(q[3].delay,500);assert.equal(q[2].collectionIds,null);}
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
  const jobs=f.writes.filter(w=>w[0]==='queue');assert.equal(jobs.length,1);assert.equal(jobs[0][3].priority,10);const normalized=new URL(jobs[0][2].record.url);assert.equal(normalized.searchParams.get('collectionId'),'1');assert.equal(normalized.searchParams.has('collectionHandle'),false);
  assert.equal(f.writes.filter(w=>w[0]==='load').length,0);
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
 const dispatched=f.writes.find(w=>w[0]==='queue'&&w[1]==='COLLECTION_RANKING_CATALOG'&&new URL(w[2].record.url).searchParams.get('collectionHandle')==='petite');assert.ok(dispatched);const url=new URL(dispatched[2].record.url);assert.equal(url.searchParams.get('country'),'IN');assert.equal(url.searchParams.get('locale'),'en');assert.equal(url.searchParams.get('collectionHandle'),'petite');
 assert.equal(f.writes.filter(w=>w[0]==='load').length,0);
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
 await f.processCollectionWarmups('fixture.myshopify.com');assert.equal(f.writes.filter(w=>w[0]==='queue'&&new URL(w[2].record.url).searchParams.get('collectionHandle')!=='all').length,1);assert.equal(f.writes.filter(w=>w[0]==='load').length,0);
});

test('catalog preparation covers unseen collections in public markets, with individual low priority deduplicated jobs',async()=>{
 const f=await fixture();f.seeds.push({shop:'fixture.myshopify.com',collectionHandle:'seed',country:'IN',locale:'en'});
 for(let i=0;i<205;i++)f.catalog.push({shop:'fixture.myshopify.com',id:'gid://shopify/Collection/'+String(i).padStart(4,'0')});
 f.catalog.push({shop:'other.myshopify.com',id:'gid://shopify/Collection/9999'});
 f.records.push(JSON.stringify({url:'https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=1&country=US&locale=en&page=1',collectionId:'1'}));
 f.records.push(JSON.stringify({url:'https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=2&country=CA&page=1&customerTags=VIP',collectionId:'2'}));
 await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');
 const jobs=f.writes.filter(w=>w[0]==='queue');assert.equal(jobs.length,412);
 assert.equal(new Set(jobs.map(w=>w[3].jobId)).size,412);
 assert.equal(jobs.filter(w=>new URL(w[2].record.url).searchParams.get('collectionHandle')==='all').length,2);
 for(const job of jobs){assert.equal(job[1],'COLLECTION_RANKING_CATALOG');assert.equal(job[3].priority,2);
  const url=new URL(job[2].record.url);assert.equal(url.origin,'https://ranking.internal');assert.equal(url.searchParams.get('shop'),'fixture.myshopify.com');
  assert.ok(['IN','US'].includes(url.searchParams.get('country')));assert.equal(url.searchParams.get('sortBy'),'best-selling');}
 await f.processCollectionWarmups('fixture.myshopify.com',null,jobs[0][2].record);
 assert.equal(f.writes.filter(w=>w[0]==='load').length,2);
});

test('catalog preparation covers every observed market and never invents a public context without one',async()=>{
 const f=await fixture();f.catalog.push({shop:'fixture.myshopify.com',id:'123'});
 await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');assert.equal(f.writes.length,0);
 for(const country of ['IN','US','CA','AU','GB','FR'])f.records.push(JSON.stringify({url:`https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=1&country=${country}&locale=en&page=1`,collectionId:'1'}));
 await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');assert.equal(f.writes.filter(w=>w[0]==='queue').length,12);
});

test('every enabled country for a connected store schedules every catalog collection without a visitor',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 f.connections.set(shop,{countries:['US','IN','GB','CA','AU'],locale:'en'});
 for(const id of ['1','2','3'])f.catalog.push({shop,id:'gid://shopify/Collection/'+id});
 await f.scheduleCatalogCollectionWarmups(shop);
 const jobs=f.writes.filter(w=>w[0]==='queue');
 assert.equal(jobs.length,20);
 for(const country of ['US','IN','GB','CA','AU'])for(const id of ['1','2','3'])
  assert.ok(jobs.some(w=>w[2].record.collectionId===id&&new URL(w[2].record.url).searchParams.get('country')===country));
});

test('a connected store does not replay a country removed from its enabled list',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 f.connections.set(shop,{countries:['US'],locale:'en'});
 f.records.push(JSON.stringify({url:`https://ranking.internal/api/filter?shop=${shop}&collectionId=1&country=IN&locale=en&page=1`,collectionId:'1'}));
 f.catalog.push({shop,id:'gid://shopify/Collection/1'});
 await f.scheduleCatalogCollectionWarmups(shop);
 assert.equal(f.writes.filter(w=>w[0]==='queue').length,2);
 assert.ok(f.writes.filter(w=>w[0]==='queue').every(w=>new URL(w[2].record.url).searchParams.get('country')==='US'));
});

test('an installed store without observed visits prepares every collection in its primary market',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 f.setPrimary({shopAddress:{countryCodeV2:'US'}});
 for(const id of ['1','2','3'])f.catalog.push({shop,id:'gid://shopify/Collection/'+id});
 await f.scheduleCatalogCollectionWarmups(shop);
 const jobs=f.writes.filter(w=>w[0]==='queue');
 assert.equal(jobs.length,4);
 assert.ok(jobs.every(w=>new URL(w[2].record.url).searchParams.get('country')==='US'));
 assert.equal(f.snapshots.has(`collectionPrimaryMarket:${shop}`),true);
});
test('an observed secondary country does not hide an unconnected store primary country',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 f.setPrimary({shopAddress:{countryCodeV2:'US'}});
 f.records.push(JSON.stringify({url:`https://ranking.internal/api/filter?shop=${shop}&collectionId=1&country=IN&locale=en&page=1`,collectionId:'1'}));
 f.catalog.push({shop,id:'gid://shopify/Collection/1'});
 await f.scheduleCatalogCollectionWarmups(shop);
 const countries=new Set(f.writes.filter(w=>w[0]==='queue').map(w=>new URL(w[2].record.url).searchParams.get('country')));
 assert.deepEqual([...countries].sort(),['IN','US']);
});

test('missing published collection pages run ahead of already published pages in the same market',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 f.seeds.push({shop,collectionHandle:'seed',country:'IN',locale:'en'});
 for(const id of ['1','2'])f.catalog.push({shop,id:'gid://shopify/Collection/'+id});
 const publishedUrl=new URL('https://ranking.internal/api/filter');
 for(const [key,value]of Object.entries({shop,collectionId:'1',country:'IN',locale:'en',sortBy:'best-selling',page:'1',limit:'25',responseProfile:'collection-preview-v1'}))publishedUrl.searchParams.set(key,value);
 f.published.push({aliases:[publishedCollectionKey(new Request(publishedUrl))],validatedAt:new Date(Date.now()-1000)});
 await f.scheduleCatalogCollectionWarmups(shop);
 const jobs=f.writes.filter(w=>w[0]==='queue');
 assert.equal(jobs.find(w=>w[2].record.collectionId==='1')[3].priority,10);
 assert.equal(jobs.find(w=>w[2].record.collectionId==='2')[3].priority,2);
});
test('coverage audit promotes a saved alias that fails the current published-page proof',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 f.seeds.push({shop,collectionHandle:'seed',country:'IN',locale:'en'});
 f.catalog.push({shop,id:'gid://shopify/Collection/1'});
 const url=new URL('https://ranking.internal/api/filter');
 for(const [key,value]of Object.entries({shop,collectionId:'1',country:'IN',locale:'en',sortBy:'best-selling',page:'1',limit:'25',responseProfile:'collection-preview-v1'}))url.searchParams.set(key,value);
 f.published.push({aliases:[publishedCollectionKey(new Request(url))],validatedAt:new Date(Date.now()-1000)});
 f.setProbe(()=>null);
 await f.scheduleCatalogCollectionWarmups(shop,null,10,null,false,true);
 assert.ok(f.writes.some(row=>row[0]==='probe'));
 assert.equal(f.writes.find(row=>row[0]==='queue'&&row[2].record.collectionId==='1')[3].priority,2);
});
test('a scoped catalog invalidation promotes only its own published collection',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 f.seeds.push({shop,collectionHandle:'seed',country:'IN',locale:'en'});
 for(const id of ['1','2']){
  f.catalog.push({shop,id:'gid://shopify/Collection/'+id});
  const url=new URL('https://ranking.internal/api/filter');
  for(const [key,value]of Object.entries({shop,collectionId:id,country:'IN',locale:'en',sortBy:'best-selling',page:'1',limit:'25',responseProfile:'collection-preview-v1'}))url.searchParams.set(key,value);
  f.published.push({aliases:[publishedCollectionKey(new Request(url))],validatedAt:new Date(Date.now()-1000)});
 }
 f.snapshots.set(catalogPublicationInvalidatedAtKey(shop,'1'),String(Date.now()));
 await f.scheduleCatalogCollectionWarmups(shop);
 const jobs=f.writes.filter(row=>row[0]==='queue'&&row[2].record.collectionId!=='all');
 assert.equal(jobs.find(row=>row[2].record.collectionId==='1')[3].priority,2);
 assert.equal(jobs.find(row=>row[2].record.collectionId==='2')[3].priority,10);
 f.snapshots.set(configurationInvalidatedAtKey(shop),String(Date.now()));
 await f.scheduleCatalogCollectionWarmups(shop);
 assert.equal(jobs.find(row=>row[2].record.collectionId==='2')[3].priority,2);
});

test('a country rule edit promotes only that market for background publication',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 for(const country of ['US','IN'])f.seeds.push({shop,collectionHandle:'seed',country,locale:'en'});
 f.catalog.push({shop,id:'gid://shopify/Collection/1'});
 for(const country of ['US','IN']){
  const url=new URL('https://ranking.internal/api/filter');
  for(const [key,value]of Object.entries({shop,collectionId:'1',country,locale:'en',sortBy:'best-selling',page:'1',limit:'25',responseProfile:'collection-preview-v1'}))url.searchParams.set(key,value);
  f.published.push({aliases:[publishedCollectionKey(new Request(url))],validatedAt:new Date(Date.now()-1000)});
 }
 f.snapshots.set(marketRuleInvalidatedAtKey(shop,'US'),String(Date.now()));
 await f.scheduleCatalogCollectionWarmups(shop);
 const jobs=f.writes.filter(row=>row[0]==='queue'&&row[2].record.collectionId==='1');
 assert.equal(jobs.find(row=>row[2].record.url.includes('country=US'))[3].priority,2);
 assert.equal(jobs.find(row=>row[2].record.url.includes('country=IN'))[3].priority,10);
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

test('existing catalog jobs are promoted into the fair background lane without duplicate jobs',async()=>{
 const f=await fixture();f.seeds.push({shop:'fixture.myshopify.com',collectionHandle:'seed',country:'IN',locale:'en'});f.catalog.push({shop:'fixture.myshopify.com',id:'gid://shopify/Collection/1'});
 await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');
 const job=[...f.jobs.values()][0];job.opts.priority=20;
 await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');
 assert.equal(job.opts.priority,2);assert.equal(f.writes.filter(w=>w[0]==='queue').length,2);
});

test('a validated published page yields without ranking setup, sessions or requeueing',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 f.setProbe(()=>Response.json({products:[]},{headers:{'X-CFP-Collection-Cards':'published'}}));
 const result=await f.processCollectionWarmups(shop,null,{url:'https://ranking.internal/api/filter?shop='+shop+'&collectionId=1&country=IN&locale=en&page=1',collectionId:'1'});
 assert.equal(result.rankingContextsReady,1);assert.equal(result.cardContextsReady,1);
 assert.equal(f.writes.filter(w=>w[0]==='load'||w[0]==='queue').length,0);
 const probes=f.writes.filter(w=>w[0]==='probe');assert.equal(probes.length,1);assert.equal(probes[0][2].probe,true);
 assert.equal(new URL(probes[0][1]).searchParams.get('responseProfile'),'collection-cards-v1');assert.equal(probes[0][2].publishedOnly,true);
});

test('a working-card hit does not mark an unpublished catalog page ready',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 f.setProbe(()=>new Response(null,{headers:{'X-CFP-Collection-Cards':'hit'}}));
 const result=await f.processCollectionWarmups(shop,null,{url:'https://ranking.internal/api/filter?shop='+shop+'&collectionId=1&country=IN&locale=en&page=1',collectionId:'1'});
 assert.equal(result.cardContextsReady,1);
 assert.equal(f.writes.filter(w=>w[0]==='load').length,2,'the worker must build and publish the full page');
 assert.ok(f.writes.filter(w=>w[0]==='probe').every(w=>w[2].publishedOnly===true));
});

test('catalog publication probe uses the exact country stock proof',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';f.setMarket({status:'ready',version:'in-stock-v2'});
 f.setProbe((_request,options)=>options.marketAvailabilityVersion==='in-stock-v2'?new Response(null,{headers:{'X-CFP-Collection-Cards':'published'}}):null);
 const result=await f.processCollectionWarmups(shop,null,{url:'https://ranking.internal/api/filter?shop='+shop+'&collectionId=1&country=IN&locale=en&page=1',collectionId:'1'});
 assert.equal(result.cardContextsReady,1);assert.equal(f.writes.filter(w=>w[0]==='load').length,0);
});

test('failed or unproven ready-card probes retain canonical preparation and card checks',async()=>{
 for(const probe of [()=>{throw Error('Unavailable');},()=>Response.json({products:[]}),()=>new Response(null,{status:202,headers:{'X-CFP-Collection-Cards':'hit'}})]){
  const f=await fixture(),shop='fixture.myshopify.com';f.setProbe(probe);
  const result=await f.processCollectionWarmups(shop,null,{url:'https://ranking.internal/api/filter?shop='+shop+'&collectionId=1&country=IN&locale=en&page=1',collectionId:'1'});
  assert.equal(result.cardContextsReady,1);assert.equal(f.writes.filter(w=>w[0]==='load').length,2);
 }
});

test('recurring recent-page sweeps cannot delay uncovered catalog pages',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com';
 f.seeds.push({shop,collectionHandle:'recent',country:'IN',locale:'en'});
 for(const id of ['1','2'])f.catalog.push({shop,id:'gid://shopify/Collection/'+id});
 f.records.push(JSON.stringify({url:'https://ranking.internal/api/filter?shop='+shop+'&collectionId=1&country=IN&locale=en&page=1',collectionId:'1'}));
 await f.scheduleCatalogCollectionWarmups(shop);
 const catalog=[...f.jobs.values()];assert.equal(catalog.length,3);
 await f.processCollectionWarmups(shop);await f.processCollectionWarmups(shop);
 assert.ok(catalog.every(job=>job.opts.priority===2));
 assert.equal(f.writes.filter(w=>w[0]==='priority').length,0);
 assert.ok(f.writes.filter(w=>w[0]==='queue'&&w[1]==='COLLECTION_RANKING_CATALOG').slice(0,3).every(w=>w[3].priority===2));
 catalog[0].opts.priority=5;await f.processCollectionWarmups(shop);
 assert.equal(catalog[0].opts.priority,2);
});

test('catalog replay requires a completed ranking and trusted worker precompute context',async()=>{
 const f=await fixture(),record={url:'https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=1&country=IN&locale=en&page=1',collectionId:'1'};
 await f.processCollectionWarmups('fixture.myshopify.com',null,record);
 assert.equal(f.writes.find(w=>w[0]==='load')[2].rankingPrecompute,true);
 f.resetPublished();
 f.setResponse(()=>Response.json({products:[],debug:{collectionBestSellingStatus:'pending'}},{status:202}));
 await assert.rejects(f.processCollectionWarmups('fixture.myshopify.com',null,record),/not ready/);
});

test('product updates precompute affected collections without any prior visitor URL',async()=>{
 const f=await fixture();f.seeds.push({shop:'fixture.myshopify.com',collectionHandle:'seed',country:'IN',locale:'en'});
 for(const id of ['123','456'])f.catalog.push({shop:'fixture.myshopify.com',id:'gid://shopify/Collection/'+id});
 await f.processCollectionWarmups('fixture.myshopify.com',['123','all']);
 const jobs=f.writes.filter(w=>w[0]==='queue');assert.equal(jobs.length,3);
 const catalog=jobs.find(w=>w[2].record.collectionId==='123');assert.ok(catalog);assert.equal(catalog[3].priority,2);
 assert.ok(jobs.some(w=>new URL(w[2].record.url).searchParams.get('collectionHandle')==='all'));
 assert.equal(jobs.some(w=>w[2].record.collectionId==='456'),false);
});


test('catalog completion requires a verified publication after card construction',async()=>{
 for(const state of ['stored','published']){
  const f=await fixture();let calls=0;f.setResponse(()=>++calls===1?Response.json({warmup:true}):Response.json({products:[]},{headers:{'X-CFP-Collection-Cards':state}}));
  const result=await f.processCollectionWarmups('fixture.myshopify.com',null,{url:'https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=1&country=IN&locale=en&page=1',collectionId:'1'});
  assert.equal(result.rankingContextsReady,1);assert.equal(result.cardContextsReady,1);assert.equal(result.cardContextsUnavailable,0);
 }
});

test('catalog card misses, pending responses and render/storage failures retry the same unfinished context',async()=>{
 const record={url:'https://ranking.internal/api/filter?shop=fixture.myshopify.com&collectionId=1&country=IN&locale=en&page=1',collectionId:'1'};
 for(const failure of ['miss','pending','error','throw','unknown','empty']){
  const f=await fixture();let fail=true,calls=0;
  f.setResponse((_request,context)=>{
   calls++;if(!context.rankingCardsPrecompute)return Response.json({warmup:true});
   if(!fail)return Response.json({products:[]},{headers:{'X-CFP-Collection-Cards':'stored'}});
   if(failure==='throw')throw Error('Storage unavailable');
   return Response.json({products:[]},{status:failure==='pending'?202:failure==='error'?503:200,
    headers:{'X-CFP-Collection-Cards':failure==='empty'?'':failure==='unknown'?'unexpected':failure==='pending'||failure==='error'?'stored':'miss'}});
  });
  await assert.rejects(f.processCollectionWarmups('fixture.myshopify.com',null,record),{code:'COLLECTION_CARDS_NOT_READY'});
  assert.equal(f.writes.filter(w=>w[0]==='queue').length,0);
  fail=false;const result=await f.processCollectionWarmups('fixture.myshopify.com',null,record);
  assert.equal(result.cardContextsReady,1);assert.equal(result.cardContextsUnavailable,0);assert.equal(calls,4);
 }
});

test('catalog jobs use bounded exponential retries while recent warmups still finish other contexts',async()=>{
 const f=await fixture();f.seeds.push({shop:'fixture.myshopify.com',collectionHandle:'seed',country:'IN',locale:'en'});f.catalog.push({shop:'fixture.myshopify.com',id:'gid://shopify/Collection/1'});
 f.setResponse((_request,context)=>context.rankingCardsPrecompute?Response.json({products:[]},{headers:{'X-CFP-Collection-Cards':'miss'}}):Response.json({warmup:true}));
 await f.processCollectionWarmups('fixture.myshopify.com');
 assert.equal(f.writes.filter(w=>w[0]==='load').length,0);
 const jobs=f.writes.filter(w=>w[0]==='queue');assert.equal(jobs.length,3);
 assert.equal(jobs[0][3].attempts,5);assert.equal(jobs[0][3].backoff.type,'exponential');assert.equal(jobs[0][3].backoff.delay,10000);
 await f.scheduleCatalogCollectionWarmups('fixture.myshopify.com');assert.equal(f.writes.filter(w=>w[0]==='queue').length,3);
});
