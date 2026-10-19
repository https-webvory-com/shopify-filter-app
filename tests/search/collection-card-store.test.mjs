import {createCardStateReader} from '../../app/utils/collectionCardState.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionCardStore,collectionCardKey} from '../../app/utils/collectionCardStore.js';
import {encodePreparation} from '../../app/utils/collectionPreparationPayload.js';
import {isPublicCollectionCards} from '../../app/utils/collectionCards.js';

function fixture(options={}){
 const shop='fixture.myshopify.com',url=`https://api.test/api/filter?shop=${shop}&country=IN&locale=en&collectionHandle=one&sortBy=best-selling&page=1&limit=25&responseProfile=collection-cards-v1`;
 const values=new Map(),sessions=[];let clock=100000,valid=true,validation=async()=>valid;
 const prepared={ids:['1','2'],metadata:{'1':{merchandisingImage:'red.jpg'}},productRevision:'0',preparedAt:clock,reusableDataRevision:'0:0',orderUpdatedAt:100};
 const state={configuration:'0',products:'0',globalProducts:'0',hardAll:'0',hardCollection:'0',scheduleEpoch:'0',orderRevision:'native-order'};
 let source=encodePreparation(prepared);
 const redis={get:async key=>values.get(key),setex:async(key,_ttl,value)=>values.set(key,value)};
 const store=createCollectionCardStore({redis,now:()=>clock,readState:async()=>({...state,preparedRaw:source}),validateCards:(...args)=>validation(...args),createSession:async(request,entry,value)=>{sessions.push({url:request.url,entry,value});return {token:'frozen-'+sessions.length};},...options});
 const request=new Request(url),spec={shop,collectionId:'gid://shopify/Collection/1',retainForIdle:true,revision:'0',orderRevision:'native-order',pinnedIds:[],rule:{conditions:[]}};
 const begin=()=>store.begin({request,spec,preparedKey:`collectionPreparedSequence:${shop}:background-v2:`+'a'.repeat(64),rankingSession:{ids:prepared.ids,metadata:prepared.metadata,updatedAt:100},attributes:['id','shop','status'],collectionHandle:'one'});
 const payload={rankingToken:'background-placeholder',products:[{id:'1',variants:[{id:'v1'}],images:['red.jpg']},{id:'2'}],totalCount:2,settings:[],globalSettings:{},mergedValues:[],facets:{tags:[{value:'Heavy facets',count:2}]}};
 return {store,values,sessions,redis,state,prepared,request,spec,payload,begin,setSource:value=>source=value,setValidation:fn=>validation=fn,setValid:v=>valid=v,advance:ms=>clock+=ms};
}

test('prepared cards serve before any visitor, omit facets and create URL-specific immutable sessions only on visits',async()=>{
 const f=fixture(),lease=await f.begin();assert.ok(lease);assert.equal(await lease.finish(f.payload,'fingerprint'),true);assert.equal(f.sessions.length,0);
 const response=await f.store.get(f.request),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('X-CFP-Collection-Cards'),'hit');assert.equal(body.cfpCards.version,1);assert.deepEqual(body.products,f.payload.products);assert.equal(body.facets,undefined);
 assert.equal(body.rankingToken,'frozen-1');assert.equal(body.cfpConfiguration,undefined);
 const alias=new URL(f.request.url);alias.searchParams.delete('collectionHandle');alias.searchParams.set('collectionId','1');
 assert.equal((await f.store.get(new Request(alias))).status,200);assert.equal(f.sessions.length,2);assert.notEqual(f.sessions[0].url,f.sessions[1].url);
 assert.deepEqual(f.sessions[1].value.ids,['1','2']);
});

test('private, filtered, token, search, custom sort, duplicate and later-page requests cannot use public snapshots',async()=>{
 const f=fixture();await(await f.begin()).finish(f.payload,'fingerprint');
 for(const extra of ['customer_tags=VIP','q=red','options[Color][]=Red','rankingToken=token','page=2','country=US','sortBy=price-ascending','unknown=1']){
  const request=new Request(f.request.url+'&'+extra);assert.equal(isPublicCollectionCards(request),false,extra);assert.equal(await f.store.get(request),null);
 }
 for(const [key,value]of [['country','US'],['locale','fr'],['collectionHandle','another']]){const url=new URL(f.request.url);url.searchParams.set(key,value);assert.equal(await f.store.get(new Request(url)),null);}
});

test('current products, prepared sequence, configuration, data epochs and native order are validated before serving',async()=>{
 for(const change of ['configuration','products','hardAll','hardCollection','scheduleEpoch','order','missing','sequence','metadata','cards','corrupt','expired']){
  const f=fixture();await(await f.begin()).finish(f.payload,'fingerprint');
  if(['configuration','products','hardAll','hardCollection','scheduleEpoch'].includes(change))f.state[change]='1';
  if(change==='order')f.state.orderRevision='new';if(change==='missing')f.setSource(null);
  if(change==='sequence')f.setSource(encodePreparation({...f.prepared,ids:['2','1']}));
  if(change==='metadata')f.setSource(encodePreparation({...f.prepared,metadata:{}}));
  if(change==='cards')f.setValid(false);if(change==='corrupt')f.values.set(collectionCardKey(f.request),'{broken');
  if(change==='expired')f.advance(86400001);
  assert.equal(await f.store.get(f.request),null,change);
 }
});

test('unrelated product changes preserve native snapshots while external Include inputs require the global version',async()=>{
 const native=fixture();await(await native.begin()).finish(native.payload,'fp');native.state.globalProducts='1';assert.ok(await native.store.get(native.request));
 const external=fixture();external.spec.rule.ruleGroups=[{conditions:[{action:'Include',field:'Tags',value:'Outside'}]}];
 external.prepared.reusableDataRevision='0:0:0';external.setSource(encodePreparation(external.prepared));
 await(await external.begin()).finish(external.payload,'fp');external.state.globalProducts='1';assert.equal(await external.store.get(external.request),null);
});

test('changes during validation or construction reject snapshots and optional storage failures do not hide cards',async()=>{
 const f=fixture();await(await f.begin()).finish(f.payload,'fp');f.setValidation(async()=>{f.state.products='1';return true;});assert.equal(await f.store.get(f.request),null);
 const boundary=fixture();boundary.state.scheduleChangedAt=100001;assert.equal(await boundary.begin(),null);
 const changedOrder=fixture();changedOrder.state.orderRevision='new-native-order';assert.equal(await changedOrder.begin(),null);
 const changed=fixture(),lease=await changed.begin();changed.state.configuration='1';assert.equal(await lease.finish(changed.payload,'fp'),undefined);assert.equal(changed.values.size,0);
 const unavailable=fixture();unavailable.redis.setex=()=>{throw Error('unavailable');};await assert.doesNotReject(async()=>{await(await unavailable.begin()).finish(unavailable.payload,'fp');});
 const tiny=fixture({maxEntryBytes:1});await(await tiny.begin()).finish(tiny.payload,'fp');assert.equal(tiny.values.size,0);
});

test('optional snapshot timeouts cannot hold up canonical fallback or create late sessions',async()=>{
 const f=fixture({readBudgetMs:5});await(await f.begin()).finish(f.payload,'fp');
 f.setValidation(async()=>{await new Promise(r=>setTimeout(r,30));return true;});
 assert.equal(await f.store.get(f.request),null);await new Promise(r=>setTimeout(r,40));assert.equal(f.sessions.length,0);
});


test('production card adapter rejects fallback ranking keys and reads tenant-scoped current epochs',async()=>{
 const {loadModule}=await import('./helpers/search-ranking.mjs');
 const {preparationKey}=await import('../../app/utils/collectionPreparation.js');
 const calls=[],spec={shop:'fixture.myshopify.com',collectionId:'gid://shopify/Collection/1'};
 const redis={mget:async(...keys)=>{calls.push(keys);return ['1','2','3','4','5',JSON.stringify({revision:'current-native'}),'prepared'];}};
 const adapter=await loadModule('app/services/collectionCards.server.js',{
  '../db.server.js':{default:{merchandisingRule:{findMany:async()=>[]}}},'./collectionLoadingSnapshots.server.js':{loadCollectionLoadingSnapshot:async()=>null,saveCollectionLoadingSnapshot:async()=>false},'./redis.server.js':{default:redis},'./meiliClient.server.js':{default:{}},
  '../utils/collectionCardState.js':{createCardStateReader},'../utils/collectionCardStore.js':{createCollectionCardStore:()=>({get:()=>null,begin:options=>options})},
  '../utils/collectionPreparation.js':{preparationKey},'../utils/rankedCollectionPage.js':{},'../utils/collectionResponse.js':{},'./collectionRankingSession.server.js':{},
 });
 assert.equal(adapter.beginPreparedCollectionCards({spec,preparedKey:'old-order-key'}),null);
 assert.equal(adapter.beginPreparedCollectionCards({spec}).preparedKey,preparationKey(spec));
 const state=await adapter.createCardStateReader(redis)({...spec,collectionId:'1',preparedKey:'source'});
 assert.equal(state.orderRevision,'current-native');assert.equal(state.products,'2');assert.equal(state.globalProducts,'3');assert.equal(state.preparedRaw,'prepared');
 assert.ok(calls[0].includes('collectionOrderSnapshot:fixture.myshopify.com:gid://shopify/Collection/1'));assert.equal(calls[0].at(-2),'source');
 const database={merchandisingRule:{findMany:async()=>[{id:'scheduled',startDate:new Date(10000),endDate:new Date(20000)}]}};let clock=9999;const read=adapter.createCardStateReader(redis,database,()=>clock);const identity={...spec,collectionId:'1',preparedKey:'source'};const before=await read(identity);clock=10000;const active=await read(identity);clock=20001;const ended=await read(identity);assert.notEqual(before.scheduleEpoch,active.scheduleEpoch);assert.notEqual(active.scheduleEpoch,ended.scheduleEpoch);
});


test('durable card copies survive Redis eviction, deduplicate aliases and support a session-free readiness probe',async()=>{
 let record;const f=fixture({saveDurable:async value=>{record=value;return true;},loadDurable:async({key})=>record?.aliases.includes(key)?record.payload:null});
 await(await f.begin()).finish(f.payload,'fp');assert.ok(f.values.get(collectionCardKey(f.request)).startsWith('p1:'));assert.equal(record.aliases.length,2);
 f.values.clear();const probe=await f.store.get(f.request,{probe:true});assert.equal(probe.status,200);assert.equal(f.sessions.length,0);
 const response=await f.store.get(f.request);assert.equal(response.status,200);assert.equal(f.sessions.length,1);
 f.setValid(false);assert.equal(await f.store.get(f.request),null);
});
