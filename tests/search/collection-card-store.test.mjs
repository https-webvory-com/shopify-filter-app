import {createCardStateReader} from '../../app/utils/collectionCardState.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionCardStore,collectionCardKey,collectionCardSnapshotRequest} from '../../app/utils/collectionCardStore.js';
import {encodePreparation,decodePreparation} from '../../app/utils/collectionPreparationPayload.js';
import {isPublicCollectionCards} from '../../app/utils/collectionCards.js';
import {validateCollectionCardDocuments} from '../../app/utils/collectionCardValidation.js';
import {collectionPageFingerprint} from '../../app/utils/collectionResponse.js';

function fixture(options={}){
 const shop='fixture.myshopify.com',url=`https://api.test/api/filter?shop=${shop}&country=IN&locale=en&collectionHandle=one&sortBy=best-selling&page=1&limit=25&responseProfile=collection-cards-v1`;
 const values=new Map(),sessions=[];let clock=100000,valid=true,validation=async()=>valid;
 const prepared={ids:['1','2'],metadata:{'1':{merchandisingImage:'red.jpg'}},productRevision:'0',preparedAt:clock,reusableDataRevision:'0:0',orderUpdatedAt:100,rankingEventsVersion:1};
 const state={configuration:'0',products:'0',globalProducts:'0',hardAll:'0',hardCollection:'0',scheduleEpoch:'0',orderRevision:'native-order'};
 let source=encodePreparation(prepared);
 const redis={get:async key=>values.get(key),setex:async(key,_ttl,value)=>values.set(key,value)};
 const store=createCollectionCardStore({redis,now:()=>clock,readState:async()=>({...state,preparedRaw:source}),validateCards:(...args)=>validation(...args),createSession:async(request,entry,value)=>{sessions.push({url:request.url,entry,value});return {token:'frozen-'+sessions.length};},...options});
 const request=new Request(url),spec={shop,collectionId:'gid://shopify/Collection/1',retainForIdle:true,revision:'0',orderRevision:'native-order',pinnedIds:[],rule:{conditions:[]}};
 const begin=()=>store.begin({request,spec,preparedKey:`collectionPreparedSequence:${shop}:background-v2:`+'a'.repeat(64),rankingSession:{ids:prepared.ids,metadata:prepared.metadata,updatedAt:100},attributes:['id','shop','status'],collectionHandle:'one'});
 const payload={rankingToken:'background-placeholder',products:[{id:'1',variants:[{id:'v1'}],images:['red.jpg']},{id:'2'}],totalCount:2,settings:[],globalSettings:{},mergedValues:[],facets:{tags:[{value:'Heavy facets',count:2}]}};
 return {store,values,sessions,redis,state,prepared,request,spec,payload,begin,setSource:value=>source=value,setValidation:fn=>validation=fn,setValid:v=>valid=v,advance:ms=>clock+=ms};
}

test('All products reuses country-scoped cards without an invented Shopify collection ID',async()=>{
 const f=fixture();f.spec.collectionId=null;
 const request=new Request(f.request.url.replace('collectionHandle=one','collectionHandle=all'));
 assert.equal(isPublicCollectionCards(request),true);
 const snapshot=await f.store.begin({request,spec:f.spec,preparedKey:`collectionPreparedSequence:${f.spec.shop}:background-v2:`+'a'.repeat(64),rankingSession:{ids:f.prepared.ids,metadata:f.prepared.metadata,updatedAt:100},attributes:['id','shop','status'],collectionHandle:'all'});
 assert.ok(snapshot);await snapshot.finish(f.payload,'fp');
 assert.equal((await(await f.store.get(request)).json()).products.length,2);
 assert.equal(await f.store.get(new Request(request.url.replace('country=IN','country=US'))),null);
 for(const extra of ['customer_tags=VIP','option_Color=Black','collectionId=1'])assert.equal(isPublicCollectionCards(new Request(request.url+'&'+extra)),false);
});

test('old card presentation snapshots cannot keep serving merchandising-selected pinned variants',async()=>{
 const f=fixture();await(await f.begin()).finish(f.payload,'fp');
 let key=collectionCardKey(f.request);if(f.values.get(key).startsWith('p1:'))key=f.values.get(key).slice(3);
 const entry=decodePreparation(f.values.get(key));delete entry.cardPresentationVersion;
 f.values.set(key,encodePreparation(entry));
 assert.equal(await f.store.get(f.request),null);assert.equal(await f.store.get(f.request,{probe:true}),null);
});

test('working saved cards require their exact country availability version',async()=>{
 const f=fixture();f.spec.marketAvailabilityVersion='in-v1';await(await f.begin()).finish(f.payload,'fp');
 assert.equal(await f.store.get(f.request),null);
 assert.ok(await f.store.get(f.request,{marketAvailabilityVersion:'in-v1'}));
 assert.equal(await f.store.get(f.request,{marketAvailabilityVersion:'us-v1'}),null);
 assert.equal(await f.store.get(f.request,{marketAvailabilityVersion:'in-v2'}),null);
});

test('canonical facet follow-ups upgrade saved cards so the next visit receives collection-wide filters',async()=>{
 const f=fixture();await(await f.begin()).finish(f.payload,'fp','head');
 const url=new URL(f.request.url);url.searchParams.set('responseProfile','collection-v1');url.searchParams.set('rankingToken','validated-token');
 const lease=await f.store.begin({request:new Request(url),rankingSession:{ids:f.prepared.ids,metadata:f.prepared.metadata,updatedAt:100},attributes:['id','shop','status'],collectionHandle:'one'});
 assert.ok(lease);assert.equal(await lease.finish(f.payload,'fp','head',{facetsReady:true}),true);
 url.searchParams.delete('rankingToken');url.searchParams.set('responseProfile','collection-preview-v1');
 const request=new Request(url,{headers:{Accept:'application/x-cfp-pinned-prefix-v3'}});
 const ready=await(await f.store.get(request)).json();
 assert.equal(ready.cfpCards.facetsReady,true);assert.deepEqual(ready.facets,f.payload.facets);assert.deepEqual(ready.settings,f.payload.settings);
 assert.deepEqual(ready.products,f.payload.products);assert.equal(ready.totalCount,2);
 // A change elsewhere in this collection invalidates counts even while all
 // first-page cards and the bounded saved ranking remain reusable.
 f.state.products='changed';
 const changed=await(await f.store.get(request)).json();
 assert.equal(changed.cfpCards.facetsReady,false);assert.equal(changed.facets,undefined);assert.deepEqual(changed.products,ready.products);
});

test('saved-filter upgrades cannot adopt a different sequence, market, configuration or filtered request',async()=>{
 const f=fixture();await(await f.begin()).finish(f.payload,'fp');
 const url=new URL(f.request.url);url.searchParams.set('responseProfile','collection-v1');url.searchParams.set('rankingToken','validated-token');
 const options={request:new Request(url),rankingSession:{ids:['2','1'],metadata:f.prepared.metadata},attributes:['id']};
 assert.equal(await f.store.begin(options),null);
 options.rankingSession={ids:f.prepared.ids,metadata:f.prepared.metadata};
 const other=new URL(url);other.searchParams.set('country','US');assert.equal(await f.store.begin({...options,request:new Request(other)}),null);
 f.state.configuration='changed';assert.equal(await f.store.begin(options),null);
 for(const extra of ['option_Color=Black','customerTags=VIP','page=2','rankingToken=another'])assert.equal(collectionCardSnapshotRequest(new Request(url+'&'+extra)),null,extra);
});

test('complete paged cards validate and return all 25 cached documents instead of the legacy five-card preview',async()=>{
 const docs=Array.from({length:25},(_,i)=>({id:String(i+1),shop:'fixture.myshopify.com',status:'ACTIVE',title:'Dress '+i,handle:'dress-'+i,variants:[{id:String(i+100),available:true}]}));
 const calls=[],index={getDocuments:async options=>{calls.push(options.limit);return {results:docs.slice(0,options.limit)};}};
 const f=fixture({validateCards:(entry,prepared,options)=>validateCollectionCardDocuments(index,entry,prepared,options)});
 f.prepared.ids=docs.map(p=>p.id);f.payload.products=docs;f.payload.totalCount=25;f.payload.debug={collectionRankingStatus:'ready'};f.setSource(encodePreparation(f.prepared));
 await(await f.begin()).finish(f.payload,collectionPageFingerprint(docs),collectionPageFingerprint(docs.slice(0,5)));
 const url=new URL(f.request.url);url.searchParams.set('responseProfile','collection-preview-v1');
 const request=new Request(url,{headers:{Accept:'application/x-cfp-pinned-prefix-v3, application/json'}});
 const response=await f.store.get(request),body=await response.json();
 assert.equal(calls.at(-1),25);assert.equal(body.products.length,25);assert.equal(body.cfpCards.preview,false);
 docs[10].title='Changed later card';assert.equal(await f.store.get(request),null);assert.equal(calls.at(-1),25);
 const legacy=await f.store.get(new Request(url));assert.equal((await legacy.json()).products.length,5);assert.equal(calls.at(-1),5);
});

test('a failed published replacement cannot leave a fifty-card readiness marker that prevents background retries',async()=>{
 const saved=[],f=fixture({saveDurable:async row=>{saved.push(row);return true;},publishedPages:{get:async()=>null,publish:async()=>false}});
 const url=new URL(f.request.url);url.searchParams.set('limit','50');const request=new Request(url);
 const lease=await f.store.begin({request,spec:f.spec,preparedKey:`collectionPreparedSequence:${f.spec.shop}:background-v2:`+'a'.repeat(64),rankingSession:{ids:f.prepared.ids,metadata:f.prepared.metadata,updatedAt:100},attributes:['id'],collectionHandle:'one'});
 assert.equal(await lease.finish(f.payload,'fp'),false);assert.equal(saved.length,0);
 assert.equal(await f.store.get(request,{probe:true}),null);
});

test('a maintained old ranking can publish newly validated durable cards with an independent card lifetime',async()=>{
 const saved=[],f=fixture({saveDurable:async row=>saved.push(row)});
 f.advance(2*86400000);const lease=await f.begin();assert.ok(lease);
 assert.equal(await lease.finish(f.payload,'fp'),true);assert.equal(saved.length,1);
 assert.equal(saved[0].expiresAt-saved[0].validatedAt,86400000);
 assert.ok(await f.store.get(f.request));f.advance(86400000);assert.equal(await f.store.get(f.request),null);
});

test('precise outside dependencies survive unrelated global updates and reject lost or changed proofs',async()=>{
 const f=fixture();f.spec.pinnedIds=['2'];
 f.prepared.externalDependencies={version:1,tokens:['p'+'a'.repeat(64)]};
 f.prepared.reusableDataRevision='0:0:d1.saved';f.state.externalProducts='d1.saved';f.setSource(encodePreparation(f.prepared));
 await(await f.begin()).finish(f.payload,'fp');f.advance(7200000);f.state.globalProducts='99';
 assert.ok(await f.store.get(f.request));
 f.state.externalProducts=null;assert.equal(await f.store.get(f.request),null);
 f.state.externalProducts='d1.changed';assert.equal(await f.store.get(f.request),null);
});

test('saved cards retain idle native order across internal scores while outside score changes and races remain guarded',async()=>{
 const f=fixture();f.prepared.productRevisionSource='content-v1';f.prepared.salesDependencies={version:1,ids:['99'],revision:'s1.saved'};f.state.salesProducts='s1.saved';f.state.salesEpoch='b.initial';f.setSource(encodePreparation(f.prepared));
 await(await f.begin()).finish(f.payload,'fp');f.advance(7200000);
 f.state.globalProducts='10';f.state.salesEpoch='e.native-sales-event';
 assert.ok(await f.store.get(f.request));
 f.state.salesProducts='s1.outside-changed';assert.equal(await f.store.get(f.request),null);
 f.state.salesProducts='s1.saved';f.setValidation(async()=>{f.state.salesProducts='s1.changed-during-read';return true;});
 assert.equal(await f.store.get(f.request),null);
});

test('legacy card proofs work through baseline initialization but require adoption after a score event',async()=>{
 const f=fixture();await(await f.begin()).finish(f.payload,'fp');f.state.salesEpoch='b.initial';assert.ok(await f.store.get(f.request));
 f.state.salesEpoch='e.sales-event';assert.equal(await f.store.get(f.request),null);
});

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
 for(const change of ['configuration','hardAll','hardCollection','scheduleEpoch','order','missing','sequence','metadata','cards','corrupt','expired']){
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

test('soft product updates reuse freshly validated cards only inside the canonical ranking freshness window',async()=>{
 const native=fixture();await(await native.begin()).finish(native.payload,'fp');native.state.globalProducts='1';assert.ok(await native.store.get(native.request));
 native.state.products='1';assert.ok(await native.store.get(native.request));native.setValid(false);assert.equal(await native.store.get(native.request),null);
 native.setValid(true);native.advance(600000);assert.equal(await native.store.get(native.request),null);
 const external=fixture();external.spec.rule.ruleGroups=[{conditions:[{action:'Include',field:'Tags',value:'Outside'}]}];
 external.prepared.reusableDataRevision='0:0:0';external.setSource(encodePreparation(external.prepared));
 await(await external.begin()).finish(external.payload,'fp');external.state.globalProducts='1';assert.ok(await external.store.get(external.request));
 external.advance(599999);assert.ok(await external.store.get(external.request));external.advance(1);assert.equal(await external.store.get(external.request),null);
});

test('legacy external-candidate snapshots fall back for one-time canonical verification before indefinite reuse',async()=>{
 const f=fixture();f.spec.pinnedIds=['1'];f.prepared.reusableDataRevision='0:0:0';f.setSource(encodePreparation(f.prepared));
 await(await f.begin()).finish(f.payload,'fp');
 const {rankingEventsVersion,...legacy}=f.prepared;f.setSource(encodePreparation(legacy));
 assert.equal(await f.store.get(f.request),null);
});

test('preview delivery includes every validated card and never exposes unchecked later cards',async()=>{
 const f=fixture();await(await f.begin()).finish(f.payload,'full','head');
 const request=new Request(f.request.url.replace('collection-cards-v1','collection-preview-v1'));
 let observed;f.setValidation(async(_entry,_prepared,options)=>{observed=options.preview;options.onValidated(1);return true;});
 assert.equal((await(await f.store.get(request)).json()).products.length,1);assert.equal(observed,true);
 f.setValidation(async(_entry,_prepared,options)=>{options.onValidated(25);return true;});
 assert.equal((await(await f.store.get(request)).json()).products.length,2);
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

test('validated visitor hits notify refresh without waiting, while probes and rejected snapshots never notify',async()=>{
 const f=fixture();await(await f.begin()).finish(f.payload,'fp');
 const hits=[];let finish;
 const onHit=async value=>{hits.push(value);await new Promise(resolve=>finish=resolve);};
 assert.equal((await f.store.get(f.request,{onHit})).status,200);
 assert.equal(hits.length,1);assert.equal(hits[0].entry.collectionId,'1');assert.deepEqual(hits[0].prepared.ids,['1','2']);finish();
 await f.store.get(f.request,{probe:true,onHit});assert.equal(hits.length,1);
 f.setValid(false);assert.equal(await f.store.get(f.request,{onHit}),null);assert.equal(hits.length,1);
 f.setValid(true);assert.equal((await f.store.get(f.request,{onHit:()=>{throw Error('Queue unavailable');}})).status,200);
});


test('production card adapter rejects fallback ranking keys and reads tenant-scoped current epochs',async()=>{
 const {loadModule}=await import('./helpers/search-ranking.mjs');
 const {preparationKey}=await import('../../app/utils/collectionPreparation.js');
 const calls=[],spec={shop:'fixture.myshopify.com',collectionId:'gid://shopify/Collection/1'};
 const redis={mget:async(...keys)=>{calls.push(keys);return ['1','2','3','4','5',JSON.stringify({revision:'current-native'}),'prepared'];}};
 const adapter=await loadModule('app/services/collectionCards.server.js',{
  '../db.server.js':{default:{merchandisingRule:{findMany:async()=>[]}}},'./collectionLoadingSnapshots.server.js':{loadCollectionLoadingSnapshot:async()=>null,saveCollectionLoadingSnapshot:async()=>false},'./redis.server.js':{default:redis},'./meiliClient.server.js':{default:{}},
  '../utils/collectionCardState.js':{createCardStateReader},'../utils/collectionCardStore.js':{createCollectionCardStore:()=>({get:()=>null,begin:options=>options})},
  '../utils/collectionPreparation.js':{preparationKey},'../utils/collectionCardValidation.js':{},'./collectionRankingSession.server.js':{},
  '../utils/collectionPreparationTelemetry.js':{createCollectionPreparationTelemetry:()=>async()=>{}},
  '../utils/collectionPublishedPage.js':{createPublishedCollectionPages:()=>({get:async()=>null,publish:async()=>true})},
 });
 assert.equal(adapter.beginPreparedCollectionCards({spec,preparedKey:'old-order-key'}),null);
 assert.equal(adapter.beginPreparedCollectionCards({spec}).preparedKey,preparationKey(spec));
 const state=await adapter.createCardStateReader(redis)({...spec,collectionId:'1',preparedKey:'source'});
 assert.equal(state.orderRevision,'current-native');assert.equal(state.products,'2');assert.equal(state.globalProducts,'3');assert.equal(state.preparedRaw,'prepared');
 assert.ok(calls[0].includes('collectionOrderSnapshot:fixture.myshopify.com:gid://shopify/Collection/1'));assert.equal(calls[0][6],'source');assert.ok(calls[0].includes('collectionProductContentRevision:fixture.myshopify.com:1'));
 const database={merchandisingRule:{findMany:async()=>[{id:'scheduled',startDate:new Date(10000),endDate:new Date(20000)}]}};let clock=9999;const read=adapter.createCardStateReader(redis,database,()=>clock);const identity={...spec,collectionId:'1',preparedKey:'source'};const before=await read(identity);clock=10000;const active=await read(identity);clock=20001;const ended=await read(identity);assert.notEqual(before.scheduleEpoch,active.scheduleEpoch);assert.notEqual(active.scheduleEpoch,ended.scheduleEpoch);
});


test('durable card copies survive Redis eviction, deduplicate aliases and support a session-free readiness probe',async()=>{
 let record;const f=fixture({saveDurable:async value=>{record=value;return true;},loadDurable:async({key})=>record?.aliases.includes(key)?record.payload:null});
 await(await f.begin()).finish(f.payload,'fp');assert.ok(f.values.get(collectionCardKey(f.request)).startsWith('p1:'));assert.equal(record.aliases.length,2);
 f.values.clear();const probe=await f.store.get(f.request,{probe:true});assert.equal(probe.status,200);assert.equal(f.sessions.length,0);
 const response=await f.store.get(f.request);assert.equal(response.status,200);assert.equal(f.sessions.length,1);
 f.setValid(false);assert.equal(await f.store.get(f.request),null);
});
