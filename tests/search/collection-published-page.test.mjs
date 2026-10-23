import test from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import {createPublishedCollectionPages,publishedCollectionKey} from '../../app/utils/collectionPublishedPage.js';
import {loadModule} from './helpers/search-ranking.mjs';
import {encodePreparation,decodePreparation} from '../../app/utils/collectionPreparationPayload.js';
const sessions=await loadModule('app/services/collectionRankingSession.server.js',{'node:crypto':crypto,'./redis.server.js':{default:{setex:async()=>{}}}});

function fixture(options={}){
 const shop='fixture.myshopify.com',values=new Map(),rows=new Map();let time=100000;
 const url='https://api.test/api/filter?shop='+shop+'&country=IN&locale=en&collectionHandle=one&sortBy=best-selling&page=1&limit=25&responseProfile=collection-preview-v1';
 const headers={Accept:'application/x-cfp-published-page-v1, application/x-cfp-pinned-prefix-v3, application/json'};
 const request=(changes={})=>{const u=new URL(url);for(const[k,v]of Object.entries(changes))u.searchParams.set(k,v);return new Request(u,{headers});};
 const store=createPublishedCollectionPages({...options,now:()=>time,redis:{get:async k=>values.get(k),setex:async(k,_ttl,v)=>values.set(k,v)},
  saveDurable:async row=>{const old=rows.get(row.key);if(old&&old.validatedAt>row.validatedAt)return false;rows.set(row.key,row);return true;},
  loadDurable:async({shop:tenant,key})=>[...rows.values()].find(r=>r.shop===tenant&&r.aliases.includes(key))?.payload,
  createSession:(req,entry)=>sessions.saveCollectionRankingSession(entry.shop,sessions.collectionRankingFingerprint(req.url),entry.ids,entry.sessionUpdatedAt,entry.metadata),
 });
 const ids=Array.from({length:70},(_,i)=>String(i+1));
 const payload={totalCount:70,products:ids.slice(0,50).map(id=>({id,title:'Dress '+id,handle:'dress-'+id,variants:[{id:'v'+id,price:100}]})),settings:[{field:'Color'}],facets:{options:{Color:[{value:'Black',count:70}]}},globalSettings:{},debug:{collectionRankingStatus:'ready'}};
 const publish=(options={})=>store.publish({request:request({limit:'50',responseProfile:'collection-cards-v1'}),collectionId:'1',collectionHandle:'one',prepared:{ids,metadata:{}},payload,sessionUpdatedAt:time,...options});
 return{store,request,values,rows,ids,payload,publish,advance:ms=>time+=ms,now:()=>time};
}

test('published pages from an older card presentation rebuild instead of retaining the old pinned variant',async()=>{
 const f=fixture();await f.publish();f.values.clear();
 const row=[...f.rows.values()][0],entry=decodePreparation(row.payload);delete entry.cardPresentationVersion;row.payload=encodePreparation(entry);
 assert.equal(await f.store.get(f.request()),null);
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
  assert.equal((await f.store.get(f.request({page:'2',rankingToken:first.rankingToken}))).status,409);
 });
}
test('published cards decline safely when current settings cannot be read',async()=>{
 const f=fixture({readGlobalSettings:async()=>{throw Error('unavailable');}});await f.publish();assert.equal(await f.store.get(f.request()),null);
});


test('new visits reject old pin and merchandising configurations and prioritize a replacement',async()=>{
 let revision='one';const f=fixture({readConfigurationRevision:async()=>revision});await f.publish({configuration:'one'});
 const first=await(await f.store.get(f.request())).json();revision='two';const hits=[];
 assert.equal(await f.store.get(f.request(),{onHit:value=>hits.push(value)}),null);
 await Promise.resolve();assert.equal(hits.length,1);assert.equal(hits[0].refreshDue,true);
 const second=await(await f.store.get(f.request({page:'2',rankingToken:first.rankingToken}))).json();
 assert.deepEqual(second.products.map(p=>p.id),f.ids.slice(25,50));
 f.advance(1);await f.publish({configuration:'two'});assert.equal((await f.store.get(f.request())).status,200);
});

test('unversioned publications safely fall back rather than hiding newly saved rules',async()=>{
 const f=fixture({readConfigurationRevision:async()=>'0'});await f.publish();assert.equal(await f.store.get(f.request()),null);
});

test('products that become sold out cannot escape through either published page',async()=>{
 let eligible=true;const calls=[];const f=fixture({readGlobalSettings:async()=>({showOnlyInStock:true}),validateProducts:async input=>{calls.push(input);return eligible;}});
 f.payload.globalSettings={showOnlyInStock:true};await f.publish();const first=await(await f.store.get(f.request())).json();
 assert.equal(calls[0].products.length,25);assert.equal(calls[0].shop,'fixture.myshopify.com');
 eligible=false;assert.equal(await f.store.get(f.request()),null);
 assert.equal((await f.store.get(f.request({page:'2',rankingToken:first.rankingToken}))).status,409);
});


test('changed shopper-market eligibility rejects a published count even when its displayed cards remain available',async()=>{
 let market='old';const f=fixture({readMarketAvailabilityRevision:async()=>market});
 f.payload.globalSettings={showOnlyInStock:true};await f.publish({marketAvailabilityRevision:'old'});
 assert.equal((await f.store.get(f.request())).status,200);market='new';assert.equal(await f.store.get(f.request()),null);
 f.advance(1);await f.publish({marketAvailabilityRevision:'new'});assert.equal((await f.store.get(f.request())).status,200);
});
