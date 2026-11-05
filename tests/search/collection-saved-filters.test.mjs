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
 const context={window,location,navigator:{},URL,URLSearchParams,Event,Date,document:{querySelector:()=>null,addEventListener:(name,fn)=>events[name]=fn},fetch:async(url,options)=>{calls.push({url,options});return {status:200,json:async()=>({cfpFilters:{version:1}})};}};
 vm.runInNewContext(await fs.readFile('extensions/theme-extension/assets/collectionFilters.js','utf8'),context);
 events.pointerover({target:{closest:()=>({href:'https://shop.test/collections/formal'})}});
 assert.equal(location.pathname,'/');assert.equal(calls.length,1);
 const url=new URL(calls[0].url);assert.equal(url.searchParams.get('shop'),'fixture.myshopify.com');
 assert.equal(url.searchParams.get('collectionHandle'),'formal');assert.equal(url.searchParams.get('country'),'US');
 assert.equal(calls[0].options.priority,'low');assert.equal(calls[0].options.cache,'no-cache');
 await window.cfpLoadSavedFilters(new URLSearchParams({shop:'fixture.myshopify.com',country:'US',locale:'en',collectionHandle:'one',q:'dress'}));
 assert.equal(calls.length,1);
});
