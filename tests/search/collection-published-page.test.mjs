import {productRefreshIntervalMs} from '../../app/utils/collectionPreparation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import {createPublishedCollectionPages,publishedCollectionKey} from '../../app/utils/collectionPublishedPage.js';
import {loadModule} from './helpers/search-ranking.mjs';
import {encodePreparation,decodePreparation} from '../../app/utils/collectionPreparationPayload.js';
import {createShopCacheInvalidation} from '../../app/utils/shopCacheInvalidation.js';
const sessions=await loadModule('app/services/collectionRankingSession.server.js',{'node:crypto':crypto,'./redis.server.js':{default:{setex:async()=>{}}}});

function fixture(options={}){
 const shop='fixture.myshopify.com',values=new Map(),rows=new Map();let time=100000,sessionCalls=0,lastSession=null;
 const url='https://api.test/api/filter?shop='+shop+'&country=IN&locale=en&collectionHandle=one&sortBy=best-selling&page=1&limit=25&responseProfile=collection-preview-v1';
 const headers={Accept:'application/x-cfp-published-page-v1, application/x-cfp-pinned-prefix-v3, application/json'};
 const request=(changes={})=>{const u=new URL(url);for(const[k,v]of Object.entries(changes))u.searchParams.set(k,v);return new Request(u,{headers});};
 const store=createPublishedCollectionPages({...options,now:()=>time,redis:{get:async k=>values.get(k),setex:async(k,_ttl,v)=>values.set(k,v),
   set:async(k,v,mode)=>{if(mode!=='NX'||!values.has(k))values.set(k,v);},del:async k=>values.delete(k)},
  saveDurable:async row=>{const old=rows.get(row.key);if(old&&old.validatedAt>row.validatedAt)return false;rows.set(row.key,row);return true;},
  loadDurable:async({shop:tenant,key})=>[...rows.values()].find(r=>r.shop===tenant&&r.aliases.includes(key))?.payload,
  createSession:async(req,entry)=>{sessionCalls++;lastSession=await sessions.saveCollectionRankingSession(entry.shop,sessions.collectionRankingFingerprint(req.url),entry.ids,entry.sessionUpdatedAt,entry.metadata,entry.membershipProof);return lastSession;},
 });
 const ids=Array.from({length:70},(_,i)=>String(i+1));
 const payload={totalCount:70,products:ids.slice(0,50).map(id=>({id,title:'Dress '+id,handle:'dress-'+id,variants:[{id:'v'+id,price:100}]})),settings:[{field:'Color'}],facets:{options:{Color:[{value:'Black',count:70}]}},globalSettings:{},debug:{collectionRankingStatus:'ready'}};
 const publish=(options={})=>store.publish({request:request({limit:'50',responseProfile:'collection-cards-v1'}),collectionId:'1',collectionHandle:'one',prepared:{ids,metadata:{}},payload,sessionUpdatedAt:time,...options});
 return{store,request,values,rows,ids,payload,publish,advance:ms=>time+=ms,now:()=>time,sessionCalls:()=>sessionCalls,lastSession:()=>lastSession};
}

for(const proof of ['a'.repeat(64),'snapshot-v1:'+'a'.repeat(64)])test('published first page retains a complete membership proof for the first filter '+proof.slice(0,12),async()=>{
 const f=fixture();
 await f.publish({membershipProof:proof});
 const first=await(await f.store.get(f.request())).json();
 const saved=decodePreparation([...f.rows.values()][0].payload);
 assert.equal(saved.membershipProof,proof);
 assert.equal(first.totalCount,f.ids.length);
 assert.ok(first.rankingToken);
 assert.equal(f.lastSession().membershipProof,proof);
});

test('legacy Include facets refresh without discarding already published product cards',async()=>{
 const f=fixture(),hits=[];f.payload.debug.activeRuleConditions=[{action:'Include',field:'Tags',value:'TopWedding'}];
 f.payload.settings=[{isEnabled:true,filterType:'option',filterKey:'Color'}];await f.publish();
 assert.equal(await f.store.get(f.request(),{filtersOnly:true}),null);assert.equal(f.sessionCalls(),0);
 assert.equal(await f.store.get(f.request(),{probe:true}),null,'background rendering replaces legacy facets');
 const cards=await(await f.store.get(f.request(),{onHit:value=>hits.push(value)})).json();
 assert.deepEqual(cards.products.map(p=>p.id),f.ids.slice(0,25));assert.equal(cards.totalCount,70);
 assert.equal(cards.cfpCards.version,2);assert.equal(cards.cfpCards.published,false);assert.equal(cards.cfpCards.facetsReady,false);
 await Promise.resolve();assert.equal(hits[0].refreshDue,true);
 f.payload.facets.collectionScopeVersion=1;f.advance(1);await f.publish();
 const filters=await(await f.store.get(f.request(),{filtersOnly:true})).json();assert.equal(filters.facets.collectionScopeVersion,1);
 const fresh=await(await f.store.get(f.request())).json();assert.deepEqual(fresh.products.map(p=>p.id),cards.products.map(p=>p.id));assert.equal(fresh.cfpCards.published,true);
});

test('legacy native membership proofs refresh in the background while complete cards remain usable',async()=>{
 const hits=[],f=fixture();
 await f.publish({membershipProof:'a'.repeat(64)});
 const response=await f.store.get(f.request(),{onHit:value=>hits.push(value)}),body=await response.json();
 assert.equal(body.products.length,25);assert.equal(body.totalCount,70);assert.equal(body.cfpCards.refreshDue,true);
 await Promise.resolve();assert.equal(hits.at(-1).refreshDue,true);
 assert.equal(await f.store.get(f.request(),{probe:true}),null);
 f.advance(1);await f.publish({membershipProof:'snapshot-v1:'+'b'.repeat(64)});
 const current=await(await f.store.get(f.request())).json();assert.equal(current.cfpCards.refreshDue,false);
 assert.deepEqual(current.products,body.products);
});

test('saved filters load from durable publication without product sessions and reject incompatible scopes',async()=>{
 const f=fixture({readConfigurationRevision:async()=> '1'});
 f.payload.settings=[{isEnabled:true,filterType:'option',filterKey:'Color'}];
 await f.publish({configuration:'1'});f.values.clear();
 const before=f.values.size;
 const response=await f.store.get(f.request(),{filtersOnly:true});
 assert.equal(response.status,200);const saved=await response.json();
 assert.equal(saved.totalCount,70);assert.equal(saved.facets.options.Color[0].count,70);
 assert.equal(saved.products,undefined);assert.equal(saved.rankingToken,undefined);
 assert.equal(f.sessionCalls(),0);assert.equal(f.values.size,before);
 const conditional=new Request(f.request().url,{headers:{'If-None-Match':response.headers.get('ETag')}});
 assert.equal((await f.store.get(conditional,{filtersOnly:true})).status,304);
 assert.equal(f.sessionCalls(),0);
 for(const changes of [{shop:'other.myshopify.com'},{country:'US'},{customer_tags:'VIP'},{'options[Color][]':'Red'}])
  assert.equal(await f.store.get(f.request(changes),{filtersOnly:true}),null);
 await f.publish({configuration:'0'});f.values.clear();
 assert.equal(await f.store.get(f.request(),{filtersOnly:true}),null);
});

test('layout and width saves keep independently published filters ready with fresh appearance',async()=>{
 let current={desktopFilterLayout:'drawer'};
 const f=fixture({readConfigurationRevision:async()=>f.values.get('collectionPreparationRevision:fixture.myshopify.com')||'0',readGlobalSettings:async()=>current});
 f.payload.settings=[{isEnabled:true,filterType:'option',filterKey:'Color'}];
 await f.publish({configuration:'0'});
 const invalidate=createShopCacheInvalidation({redis:{incr:async key=>f.values.set(key,String(Number(f.values.get(key)||0)+1))},warm:()=>{throw Error('appearance rebuilt collection');}});
 for (const layout of ['vertical','horizontal','drawer']) {
   current={desktopFilterLayout:layout,integrations:{drawerWidth:300,verticalFilterWidth:520}};
   await invalidate('fixture.myshopify.com',{kind:'presentation'});
   const response=await f.store.get(f.request(),{filtersOnly:true});
   assert.equal(response.status,200);
   const body=await response.json();
   assert.deepEqual(body.globalSettings,current);assert.deepEqual(body.facets,f.payload.facets);
   assert.equal(f.sessionCalls(),0,'filter read must not wait on a product session');
   assert.equal(body.products,undefined);
 }
});

test('older option counts refresh in the background while saved cards remain visible',async()=>{
 const f=fixture();f.payload.globalSettings.hideUnavailableVariantsWhenSelected=true;
 await f.publish();
 const old=await(await f.store.get(f.request())).json();
 assert.equal(old.products.length,25);
 assert.equal(old.cfpCards.refreshDue,true);
 assert.equal(await f.store.get(f.request({limit:'50',responseProfile:'collection-cards-v1'}),{probe:true}),null);
 f.payload.facets.variantCountVersion=1;f.advance(1);await f.publish();
 const next=await(await f.store.get(f.request())).json();
 assert.equal(next.cfpCards.refreshDue,false);
 assert.equal(next.products[0].id,old.products[0].id);
});

test('background coverage probe recognizes a complete published fifty without creating a shopper session',async()=>{
 const f=fixture();await f.publish({marketAvailabilityVersion:'in-v1'});
 const before=f.values.size;
 const probeUrl=f.request({limit:'50',responseProfile:'collection-cards-v1'}).url;
 const ready=await f.store.get(new Request(probeUrl),{probe:true,marketAvailabilityVersion:'in-v1'});
 assert.equal(ready?.headers.get('X-CFP-Collection-Cards'),'published');
 assert.equal(f.sessionCalls(),0);assert.equal(f.values.size,before);
 assert.equal(await f.store.get(f.request({limit:'50',responseProfile:'collection-cards-v1'}),{probe:true,marketAvailabilityVersion:'in-v2'}),null);
});
test('a scoped catalog change serves old cards and requires a replacement at most once per refresh interval',async()=>{
 let invalidatedAt=0;
 const f=fixture({readCatalogInvalidatedAt:async(_shop,id)=>id==='1'?invalidatedAt:0});
 await f.publish();
 const first=await(await f.store.get(f.request())).json();
 invalidatedAt=f.now();
 // A product/order change within the interval keeps the publication current.
 assert.equal((await f.store.get(f.request(),{probe:true}))?.headers.get('X-CFP-Collection-Cards'),'published');
 assert.equal((await(await f.store.get(f.request())).json()).cfpCards.refreshDue,false);
 f.advance(productRefreshIntervalMs);
 assert.equal(await f.store.get(f.request(),{probe:true}),null);
 const stalePageTwo=await f.store.get(f.request({page:'2',rankingToken:first.rankingToken}));
 assert.equal(stalePageTwo.status,200);
 const staleFirst=await(await f.store.get(f.request())).json();
 assert.equal(staleFirst.cfpCards.refreshDue,true);
 assert.equal(staleFirst.products[0].title,'Dress 1');
 f.advance(1);await f.publish();
 assert.equal((await f.store.get(f.request(),{probe:true}))?.headers.get('X-CFP-Collection-Cards'),'published');
});
test('a country rule edit rejects old cards only in that market',async()=>{
 let usMarker=0;
 const f=fixture({readMarketRuleInvalidatedAt:async(_shop,country)=>country==='US'?usMarker:0});
 await f.publish({request:f.request({country:'US',limit:'50',responseProfile:'collection-cards-v1'})});
 await f.publish();
 usMarker=f.now();
 assert.equal((await f.store.get(f.request())).status,200);
 assert.equal(await f.store.get(f.request({country:'US'})),null);
 assert.equal(await f.store.get(f.request({country:'US',limit:'50',responseProfile:'collection-cards-v1'}),{probe:true}),null);
 assert.equal((await f.store.get(f.request({limit:'50',responseProfile:'collection-cards-v1'}),{probe:true}))?.status,200);
});
test('country rule changes are never throttled by the product refresh interval',async()=>{
 let ruleAt=0;
 const f=fixture({readMarketRuleInvalidatedAt:async()=>ruleAt});
 await f.publish();ruleAt=f.now();
 assert.equal(await f.store.get(f.request(),{probe:true}),null);
});
test('outside pins or Include candidates refresh on product changes without hiding old cards',async()=>{
 let revision='old';
 const f=fixture({readExternalProof:async()=>revision});
 await f.publish({external:true});
 revision='new';
 assert.equal((await(await f.store.get(f.request())).json()).cfpCards.refreshDue,false);
 f.advance(productRefreshIntervalMs);
 const old=await(await f.store.get(f.request())).json();
 assert.equal(old.cfpCards.refreshDue,true);
 assert.equal(await f.store.get(f.request({limit:'50',responseProfile:'collection-cards-v1'}),{probe:true}),null);
 f.advance(1);await f.publish({external:true});
 assert.equal((await f.store.get(f.request(),{probe:true}))?.status,200);
});
test('an external product change during preparation cannot publish an obsolete order',async()=>{
 const f=fixture({readExternalProof:async()=> 'd1.new'});
 const descriptor={version:1,tokens:['t'+'a'.repeat(64)]};
 assert.equal(await f.publish({external:true,prepared:{ids:f.ids,metadata:{},externalDependencies:descriptor,reusableDataRevision:'0:0:d1.old'}}),false);
 assert.equal(f.rows.size,0);
});

test('All products publishes 50 cards and serves two country-isolated 25-card pages',async()=>{
 const f=fixture();
 assert.equal(await f.publish({request:f.request({collectionHandle:'all',limit:'50',responseProfile:'collection-cards-v1'}),collectionId:'all',collectionHandle:'all',marketAvailabilityVersion:'in-v1'}),true);
 const request=f.request({collectionHandle:'all'});
 const response=await f.store.get(request,{marketAvailabilityVersion:'in-v1'});
 assert.equal(response.headers.get('X-CFP-Collection-Cards'),'published');
 const first=await response.json();assert.equal(first.products.length,25);assert.equal(first.totalCount,70);
 const second=await(await f.store.get(f.request({collectionHandle:'all',page:'2',rankingToken:first.rankingToken}),{marketAvailabilityVersion:'in-v1'})).json();
 assert.deepEqual(second.products.map(p=>p.id),f.ids.slice(25,50));
 assert.equal(await f.store.get(f.request({collectionHandle:'all',country:'US'}),{marketAvailabilityVersion:'us-v1'}),null);
 assert.equal(await f.store.get(request,{marketAvailabilityVersion:'in-v2'}),null);
});

test('published pages from an older card presentation rebuild instead of retaining the old pinned variant',async()=>{
 const f=fixture();await f.publish();f.values.clear();
 const row=[...f.rows.values()][0],entry=decodePreparation(row.payload);delete entry.cardPresentationVersion;row.payload=encodePreparation(entry);
 assert.equal(await f.store.get(f.request()),null);
});

test('rollback retires stock-restricted publications without waiting for country preparation',async()=>{
 const f=fixture();await f.publish();f.values.clear();
 for(const row of f.rows.values()){
  const entry=decodePreparation(row.payload);entry.marketAvailabilityRevision='reverted-stock-proof';row.payload=encodePreparation(entry);
 }
 const refresh=[];assert.equal(await f.store.get(f.request(),{onHit:hit=>refresh.push(hit)}),null);
 await Promise.resolve();assert.equal(refresh.length,1);assert.equal(refresh[0].refreshDue,true);
 f.advance(1);await f.publish();const response=await f.store.get(f.request());
 assert.equal(response.status,200);assert.equal((await response.json()).products.length,25);
});

test('published data serves two complete 25-card pages and preserves all canonical IDs for later pagination',async()=>{
 const f=fixture();assert.equal(await f.publish(),true);
 const first=await f.store.get(f.request());assert.equal(first.headers.get('X-CFP-Collection-Cards'),'published');
 const page=await first.json();assert.equal(page.products.length,25);assert.equal(page.totalCount,70);assert.ok(page.settings&&page.facets);assert.equal(page.cfpCards.published,true);
 assert.deepEqual(page.products.map(p=>p.id),f.ids.slice(0,25));
 const second=await(await f.store.get(f.request({page:'2',rankingToken:page.rankingToken}))).json();
 assert.deepEqual(second.products.map(p=>p.id),f.ids.slice(25,50));assert.equal(second.rankingToken,page.rankingToken);
 assert.equal(await f.store.get(f.request({page:'3',rankingToken:page.rankingToken})),null);
});

test('country publications retain fast 25/50-card serving and reject an obsolete stock version',async()=>{
 const f=fixture();assert.equal(await f.publish({marketAvailabilityVersion:'india-v1'}),true);
 assert.equal(await f.store.get(f.request()),null,'a country publication is never accepted without a matching proof');
 const first=await(await f.store.get(f.request(),{marketAvailabilityVersion:'india-v1'})).json();
 assert.equal(first.products.length,25);assert.equal(first.totalCount,70);
 const second=await(await f.store.get(f.request({page:'2',rankingToken:first.rankingToken}),{marketAvailabilityVersion:'india-v1'})).json();
 assert.deepEqual(second.products.map(p=>p.id),f.ids.slice(25,50));
 assert.equal(await f.store.get(f.request(),{marketAvailabilityVersion:'india-v2'}),null);
 const stale=await f.store.get(f.request({page:'2',rankingToken:first.rankingToken}),{marketAvailabilityVersion:'india-v2'});
 assert.equal(stale,null,'an outdated copy defers page two to the ranking session');
 assert.equal(await f.store.get(f.request({country:'US'}),{marketAvailabilityVersion:'usa-v1'}),null);
});

test('changed country stock keeps a complete old page briefly while a replacement is prepared',async()=>{
 const f=fixture();await f.publish({marketAvailabilityVersion:'india-v1'});
 const stale=await(await f.store.get(f.request(),{marketAvailabilityVersion:'india-v2',allowStaleMarket:true})).json();
 assert.equal(stale.products.length,25);
 assert.equal(stale.cfpCards.refreshDue,true);
 assert.equal(await f.store.get(f.request({limit:'50',responseProfile:'collection-cards-v1'}),{probe:true,marketAvailabilityVersion:'india-v2',allowStaleMarket:true}),null);
 f.advance(600000);
 assert.equal(await f.store.get(f.request(),{marketAvailabilityVersion:'india-v2',allowStaleMarket:true}),null);
 f.advance(1);await f.publish({marketAvailabilityVersion:'india-v2'});
 assert.equal((await f.store.get(f.request(),{marketAvailabilityVersion:'india-v2'})).status,200);
});

test('an unchanged stock refresh resets the brief stale-stock window',async()=>{
 const f=fixture();await f.publish({marketAvailabilityVersion:'india-v1'});
 assert.equal((await f.store.get(f.request(),{marketAvailabilityVersion:null,allowStaleMarket:true})).status,200);
 f.advance(400000);
 assert.equal((await f.store.get(f.request(),{marketAvailabilityVersion:'india-v1'})).status,200);
 await Promise.resolve();
 f.advance(400000);
 assert.equal((await f.store.get(f.request(),{marketAvailabilityVersion:null,allowStaleMarket:true})).status,200);
});

test('page two retains its published version across replacement and rejects tokens from another context',async()=>{
 const f=fixture();await f.publish();const first=await(await f.store.get(f.request())).json();
 f.advance(1);f.payload.products=f.payload.products.map(p=>({...p,title:'Updated '+p.title}));await f.publish();
 const second=await(await f.store.get(f.request({page:'2',rankingToken:first.rankingToken}))).json();
 assert.equal(second.products[0].title,'Dress 26');
 assert.equal(await f.store.get(f.request({page:'2',country:'US',rankingToken:first.rankingToken})),null);
 assert.equal(await f.store.get(f.request({page:'2',rankingToken:'bad'})),null);
});

test('working updates and a delayed daily refresh never hide the last complete durable published version',async()=>{
 const f=fixture();await f.publish();f.values.clear();f.advance(23*3600000);
 assert.equal((await(await f.store.get(f.request())).json()).products.length,25);
 f.advance(3600000);const overdue=await(await f.store.get(f.request())).json();assert.equal(overdue.products.length,25);assert.equal(overdue.cfpCards.refreshDue,true);
});

test('filters, customer scope, different markets and unsupported clients never receive an unfiltered published page',async()=>{
 const f=fixture();await f.publish();
 for(const changes of [{q:'dress'},{option_Color:'Black'},{customerTags:'VIP'},{country:'US'},{locale:'fr'},{sortBy:'price-ascending'}])assert.equal(await f.store.get(f.request(changes)),null);
 assert.equal(await f.store.get(new Request(f.request().url)),null);
 assert.equal(await f.store.get(new Request(f.request().url,{headers:{Accept:'application/x-cfp-published-page-v1;q=0'}})),null);
 const complete=await(await f.store.get(new Request(f.request().url,{headers:{Accept:'application/x-cfp-published-page-v1'}}))).json();
 assert.equal(complete.products.length,25);assert.equal(complete.cfpCards.published,true);
 assert.equal(publishedCollectionKey(new Request(f.request().url+'&page=1')),null);
});

test('incomplete, duplicate and delayed older replacements cannot overwrite the last complete version',async()=>{
 const f=fixture();await f.publish();const initial=f.now();f.advance(10);
 assert.equal(await f.publish({payload:{...f.payload,products:f.payload.products.slice(0,49)}}),false);
 assert.equal(await f.publish({prepared:{ids:[...f.ids.slice(0,69),'1'],metadata:{}}}),false);
 assert.equal(await f.publish(),true);assert.equal(await f.publish({at:initial}),false);
 assert.equal((await(await f.store.get(f.request())).json()).products.length,25);
 assert.equal(publishedCollectionKey(f.request()),publishedCollectionKey(f.request({limit:'50'})));
});


test('published cards use current presentation settings without replacing canonical cards',async()=>{
 let current={showQuickViewCollection:false,darkMode:true,showProductCount:false};
 const f=fixture({readGlobalSettings:async shop=>{assert.equal(shop,'fixture.myshopify.com');return current;}});
 f.payload.globalSettings={showQuickViewCollection:true};await f.publish();
 const first=await(await f.store.get(f.request())).json();
 assert.deepEqual(first.globalSettings,current);assert.deepEqual(first.products.map(p=>p.id),f.ids.slice(0,25));
 current={...current,secondImageOnHover:false};
 const second=await(await f.store.get(f.request({page:'2',rankingToken:first.rankingToken}))).json();
 assert.deepEqual(second.globalSettings,current);assert.deepEqual(second.products.map(p=>p.id),f.ids.slice(25,50));
});

for(const flag of ['showOnlyInStock','prioritizeSortOverPinning','prioritizeSortOverMerchandising','hideUnavailableVariantsWhenSelected']){
 for(const enabled of [false,true]) test(`published ${flag} change from ${enabled} rejects stale eligibility on both pages`,async()=>{
  let current={[flag]:enabled};const f=fixture({readGlobalSettings:async()=>current});
  f.payload.globalSettings={...current};await f.publish();const first=await(await f.store.get(f.request())).json();
  current={[flag]:!enabled};assert.equal(await f.store.get(f.request()),null);
  assert.equal(await f.store.get(f.request({page:'2',rankingToken:first.rankingToken})),null);
 });
}
test('published cards decline safely when current settings cannot be read',async()=>{
 const f=fixture({readGlobalSettings:async()=>{throw Error('unavailable');}});await f.publish();assert.equal(await f.store.get(f.request()),null);
});

test('new visits reject old pin and merchandising cards while prioritizing a replacement',async()=>{
 let revision='one';const f=fixture({readConfigurationRevision:async()=>revision});await f.publish({configuration:'one'});
 const first=await(await f.store.get(f.request())).json();revision='two';const hits=[];
 assert.equal(await f.store.get(f.request(),{onHit:value=>hits.push(value)}),null);
 await Promise.resolve();assert.equal(hits.length,1);assert.equal(hits[0].refreshDue,true);
 assert.equal(await f.store.get(f.request(),{probe:true}),null);
 const second=await f.store.get(f.request({page:'2',rankingToken:first.rankingToken}));
 assert.equal(second,null);
 f.advance(1);await f.publish({configuration:'two'});assert.equal((await f.store.get(f.request())).status,200);
});

test('unversioned publications safely fall back rather than hiding newly saved rules',async()=>{
 const f=fixture({readConfigurationRevision:async()=>'0'});await f.publish();assert.equal(await f.store.get(f.request()),null);
});
