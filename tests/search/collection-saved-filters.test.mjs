import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {loadModule} from './helpers/search-ranking.mjs';
import {publishedCollectionKey} from '../../app/utils/collectionPublishedPage.js';

test('saved filter route rejects filtered or personalized contexts and does not start ranking on a miss',async()=>{
 const calls=[];let pending=false,personalized=true;
 const service=await loadModule('app/routes/api.collection-filters.jsx',{
  '../services/collectionCards.server.js':{getPreparedCollectionFilters:async(request,options)=>{calls.push({request,options});return null;}},
  '../services/marketAvailability.server.js':{getMarketAvailabilityState:async()=>({status:pending?'pending':'ready',version:'us-v1'})},
  '../utils/collectionPublishedPage.js':{publishedCollectionKey},
  '../services/rateLimiter.server':{rateLimit:async()=>true},
  '../db.server':{default:{merchandisingRule:{findFirst:async({where})=>{assert.equal(where.shop,'fixture.myshopify.com');return personalized?{id:'vip-rule'}:null;}}}},
 });
 const url='https://app/api/collection-filters?shop=fixture.myshopify.com&collectionHandle=one&country=US&locale=en&sortBy=best-selling&page=1&limit=25';
 assert.equal((await service.loader({request:new Request(url)})).status,202);
 assert.equal(new URL(calls[0].request.url).pathname,'/api/filter');
 assert.equal(calls[0].options.marketAvailabilityVersion,'us-v1');
 for(const extra of ['&q=dress','&options[Color][]=Red','&page=2'])
  assert.equal((await service.loader({request:new Request(url+extra)})).status,400);
 assert.equal((await service.loader({request:new Request(url+'&customer_tags=VIP')})).status,202);
 assert.equal(calls.length,1);personalized=false;
 assert.equal((await service.loader({request:new Request(url+'&customer_tags=Shop')})).status,202);
 assert.equal(calls.length,2);assert.equal(new URL(calls[1].request.url).searchParams.has('customer_tags'),false);
 pending=true;
 assert.equal((await service.loader({request:new Request(url)})).status,202);
 assert.equal(calls.length,2);
});

test('collection-link intent starts a scoped low-priority saved filter request before navigation',async()=>{
 const events={},calls=[];
 const window={Shopify:{shop:'fixture.myshopify.com',country:'US',locale:'en'},dispatchEvent:()=>{}};
 const location={href:'https://shop.test/',origin:'https://shop.test',pathname:'/',search:''};
 const context={window,location,navigator:{},URL,URLSearchParams,Event,Date,AbortController,setTimeout,clearTimeout,document:{querySelector:()=>null,addEventListener:(name,fn)=>events[name]=fn},fetch:async(url,options)=>{calls.push({url,options});return {status:200,json:async()=>({cfpFilters:{version:1}})};}};
 vm.runInNewContext(await fs.readFile('extensions/theme-extension/assets/collectionFilters.js','utf8'),context);
 events.pointerover({target:{closest:()=>({href:'https://shop.test/collections/formal'})}});
 assert.equal(location.pathname,'/');assert.equal(calls.length,1);
 const url=new URL(calls[0].url);assert.equal(url.searchParams.get('shop'),'fixture.myshopify.com');
 assert.equal(url.searchParams.get('collectionHandle'),'formal');assert.equal(url.searchParams.get('country'),'US');
 assert.equal(calls[0].options.priority,'low');assert.equal(calls[0].options.cache,'no-cache');
 await window.cfpLoadSavedFilters(new URLSearchParams({shop:'fixture.myshopify.com',country:'US',locale:'en',collectionHandle:'one',q:'dress'}));
 assert.equal(calls.length,1);
});

test('a stalled saved-filter request times out and a fresh request can recover',async()=>{
 let stall=true,requests=0;
 const window={dispatchEvent:()=>{}},context={window,location:{pathname:'/',href:'https://shop.test/',origin:'https://shop.test'},navigator:{},URL,URLSearchParams,Event,Date,AbortController,
  setTimeout:(callback,ms)=>setTimeout(callback,ms===8000?0:ms),clearTimeout,
  document:{querySelector:()=>null,addEventListener:()=>{}},fetch:async(_url,{signal})=>{
   requests++;if(stall)return new Promise((_,reject)=>{const abort=()=>reject(new DOMException('Aborted','AbortError'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
   return {status:200,json:async()=>({cfpFilters:{version:1},settings:[],facets:{}})};
  }};
 vm.runInNewContext(await fs.readFile('extensions/theme-extension/assets/collectionFilters.js','utf8'),context);
 const params=new URLSearchParams({shop:'fixture.myshopify.com',country:'US',locale:'en',collectionHandle:'one'});
 assert.equal(await window.cfpLoadSavedFilters(params),null);stall=false;
 assert.equal((await window.cfpLoadSavedFilters(params)).cfpFilters.version,1);assert.equal(requests,2);
});

async function retryFixture({savedReads=[],early=null,onDelay=()=>{}}={}){
 const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
 const block=source.slice(source.indexOf('  function startIndependentCollectionFilters('),source.indexOf('  async function fetchCollectionConfiguration('));
 const params=new URLSearchParams({shop:'fixture.myshopify.com',country:'US',locale:'en',collectionHandle:'one'});
 let clock=0,reads=0,renders=0;
 const controller=new AbortController();
 const context={templateName:'collection',filtersReady:false,cfpLastSettings:[],cfpLastFacets:{},cfpLastTotalCount:0,globalSettings:{},URLSearchParams,
  Date:{now:()=>clock},setTimeout:(callback,ms)=>setTimeout(()=>{clock+=ms;onDelay(context,controller);callback();},0),clearTimeout,
  window:{_cfpSavedFilters:{params:params.toString(),promise:Promise.resolve(early)},cfpLoadSavedFilters:async()=>{const value=savedReads[reads++]??null;return typeof value==='function'?value(controller):value;}},
  sidebar:{classList:{remove:()=>{}}},applyGlobalSettings:()=>{},renderFilterSidebar:()=>{renders++;context.filtersReady=true;},renderBreadcrumbs:()=>{},updateActiveCountBadge:()=>{},performance:{mark:()=>{}},
 };
 vm.runInNewContext(block+'\nthis.start=startIndependentCollectionFilters;',context);
 return {context,controller,params,run:()=>context.start(params,controller.signal),reads:()=>reads,renders:()=>renders};
}

test('an empty early filter read is retried independently until saved filters become ready',async()=>{
 const saved={cfpFilters:{version:1},settings:[{id:'color'}],facets:{},totalCount:25,globalSettings:{desktopFilterLayout:'vertical'}};
 const f=await retryFixture({savedReads:[null,saved]});await f.run();
 assert.equal(f.reads(),2);assert.equal(f.renders(),1);assert.equal(f.context.cfpLastTotalCount,25);
});

test('saved-filter retries stop on navigation, completed fallback or exhausted retry budget',async()=>{
 const aborted=await retryFixture({savedReads:[controller=>{controller.abort();return {cfpFilters:{version:1},settings:[{}],facets:{}};}]});
 await aborted.run();assert.equal(aborted.renders(),0);assert.equal(aborted.reads(),1);
 const complete=await retryFixture({onDelay:ctx=>{ctx.filtersReady=true;ctx.cfpLastSettings=[{}];}});
 await complete.run();assert.equal(complete.reads(),0);assert.equal(complete.renders(),0);
 const unavailable=await retryFixture();await unavailable.run();assert.ok(unavailable.reads()<=12);assert.equal(unavailable.renders(),0);
});
