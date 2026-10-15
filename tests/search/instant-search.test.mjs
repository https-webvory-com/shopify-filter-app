import * as searchColor from "../../app/utils/searchColor.js";
import {spellingCorrection} from "../../app/utils/spellingCorrection.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import {buildSearchSuggestions} from '../../app/utils/searchSuggestions.js';

const source=await fs.readFile('extensions/theme-extension/assets/instantSearch.js','utf8');
const helpers=source.slice(source.indexOf('  // Search caching'),source.indexOf('  // UI Elements'));
const search=source.slice(source.indexOf('  async function performSearch'),source.indexOf('  function renderCollections'));
const defaults=source.slice(source.indexOf('  async function fetchDefaultView'),source.indexOf('  function renderRecentSearches'));
function storage(){
 const values=new Map();
 return {values,get length(){return values.size;},key:i=>Array.from(values.keys())[i],getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
function fixture(store=storage()){
 const calls=[];const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',value:'blue dress',style:{},classList:{add(){},remove(){}},addEventListener(){}});return elements.get(id);};
 const context={sessionStorage:store,Date,URL,location:{href:'https://shop.test/'},window:{Shopify:{country:'US',currency:{active:'USD'},locale:'en'}},document:{getElementById:element},mainInput:element('cfp-main-search-input'),shopDomain:'fixture',CONFIG:{apiUrl:'https://api.test/api/search',productLimit:6},console:{error(){}},renderRecentSearches(){},renderLoading:flag=>calls.push(['loading',flag]),renderCollections:()=>calls.push(['collections']),renderProducts:async()=>calls.push(['products']),renderSuggestions:suggestions=>calls.push(['suggestions',Array.from(suggestions)]),fetch:async url=>({ok:true,status:200,json:async()=>String(url).includes('/api/search')?{products:[{title:'Blue dress'}],suggestions:['Blue formal dress']}:{resources:{results:{collections:[]}}}})};
 vm.createContext(context);vm.runInContext(helpers+search+defaults,context);
 return {context,calls,element,store};
}
test('quota errors never suppress successful live products and suggestions',async()=>{
 const store=storage();store.setItem=()=>{throw Object.assign(Error('full'),{name:'QuotaExceededError'});};
 const f=fixture(store);await f.context.performSearch('blue dress');
 assert.ok(f.calls.some(call=>call[0]==='products'));
 assert.ok(f.calls.some(call=>call[0]==='suggestions'));
 assert.ok(!f.element('cfp-search-products').innerHTML.includes('Something went wrong'));
});
test('blocked storage still allows typed and default searches',async()=>{
 const f=fixture({getItem(){throw Error('SecurityError');},get length(){throw Error('SecurityError');}});
 await f.context.performSearch('blue dress');
 f.context.mainInput.value='';await f.context.fetchDefaultView();
 assert.equal(f.calls.filter(call=>call[0]==='products').length,2);
});
test('cache expires, bounds entries and size, and preserves unrelated storage',()=>{
 const f=fixture();f.store.setItem('cart','keep');f.store.setItem('cfp_recent_searches','keep');
 for(let i=0;i<20;i++)f.context.writeInstantCache('cfp_instant_search_fixture_'+i,{products:[{title:'Dress '+i}]},{});
 assert.ok(f.store.length<=14);
 assert.equal(f.store.getItem('cart'),'keep');assert.equal(f.store.getItem('cfp_recent_searches'),'keep');
 const key='cfp_instant_search_fixture_old';f.store.setItem(key,JSON.stringify({timestamp:Date.now()-200000,productsData:{products:[]}}));
 assert.equal(f.context.readInstantCache(key),null);assert.equal(f.store.getItem(key),null);
 for(let i=0;i<10;i++)f.context.writeInstantCache('cfp_instant_search_fixture_large_'+i,{products:[{title:'x'.repeat(130000)}]},{});
 const cached=[...f.store.values.entries()].filter(([key])=>key.startsWith('cfp_instant_'));
 assert.ok(cached.reduce((sum,[,value])=>sum+value.length,0)<=500000);
 f.context.writeInstantCache('cfp_instant_search_fixture_oversized',{products:[{title:'x'.repeat(160000)}]},{});
 assert.equal(f.store.getItem('cfp_instant_search_fixture_oversized'),null);
});

test('instant cache separates customer merchandising contexts',()=>{
 const f=fixture();f.context.window.cfpCustomerTags='vip';const vip=f.context.instantCacheMarket();
 f.context.window.cfpCustomerTags='';assert.notEqual(f.context.instantCacheMarket(),vip);
});

test('typed searches send locale and customer context for merchandising',async()=>{
 const f=fixture(),urls=[];const original=f.context.fetch;
 f.context.window.Shopify.locale='fr';f.context.window.cfpCustomerTags='vip,trade';
 f.context.fetch=async url=>{urls.push(String(url));return original(url);};
 await f.context.performSearch('blue dress');
 const request=new URL(urls.find(url=>url.includes('/api/search?')));
 assert.equal(request.searchParams.get('locale'),'fr');
 assert.equal(request.searchParams.get('customer_tags'),'vip,trade');
 assert.equal(request.searchParams.get('searchType'),'instant');
});
test('failure of optional collections does not suppress products or suggestions',async()=>{
 const f=fixture();const fetch=f.context.fetch;
 f.context.fetch=async url=>String(url).includes('suggest.json')?Promise.reject(Error('collection unavailable')):fetch(url);
 await f.context.performSearch('blue dress');
 assert.ok(f.calls.some(call=>call[0]==='products'));assert.ok(f.calls.some(call=>call[0]==='suggestions'));
});
test('an older failed query cannot replace a newer query with an error',async()=>{
 const f=fixture();f.context.fetch=async()=>{f.context.mainInput.value='red dress';throw Error('older failure');};
 await f.context.performSearch('blue dress');
 assert.equal(f.element('cfp-search-products').innerHTML,'');
});
test('highlighting treats regex characters literally and escapes markup',()=>{
 const f=fixture();assert.equal(f.context.highlightSearchText('Dress (Blue)','('),'Dress <strong>(</strong>Blue)');
 assert.equal(f.context.highlightSearchText('<Dress>','Dress'),'&lt;<strong>Dress</strong>&gt;');
 assert.doesNotThrow(()=>f.context.highlightSearchText('Dress [Blue]','['));
});
test('suggestions include product names and matching color, without case duplicates',()=>{
 const products=[{title:'Pleated Satin Evening Dress',status:'ACTIVE',options:[{name:'Color',values:['Blue','Red']}]},{title:'pleated satin evening dress',options:[{name:'Color',values:['Blue']}]},{title:'Hidden dress',status:'draft'}];
 assert.deepEqual(buildSearchSuggestions('blue dress',products,['Blue','blue']),['Blue Pleated Satin Evening Dress','Blue']);
 assert.deepEqual(buildSearchSuggestions('wat',[{title:'Minimal Smartwatch For Watch Lover'}],[]),['Minimal Smartwatch For Watch Lover']);
 assert.equal(buildSearchSuggestions('',products).length,0);
 assert.equal(buildSearchSuggestions('dress',Array.from({length:10},(_,i)=>({title:'Dress '+i}))).length,6);
});
test('suggestions are not held behind slow product rendering',async()=>{
 const f=fixture();let resolve;f.context.renderProducts=()=>new Promise(r=>{resolve=r;});
 const pending=f.context.performSearch('blue dress');
 for(let i=0;i<20&&!resolve;i++)await Promise.resolve();
 assert.ok(f.calls.some(call=>call[0]==='suggestions'));resolve();await pending;
});

test('instant product cards render before market pricing and ignore stale price callbacks',async()=>{
 const price={textContent:''};const card={isConnected:true,querySelector:selector=>selector==='a'?{href:'https://shop.test/products/dress?variant=2'}:price};
 const grid={innerHTML:'',querySelectorAll:()=>[card]};const callbacks=[];
 const context={window:{Shopify:{currency:{active:'USD'}},cfpMarketPricing:{apply:(_products,callback)=>{callbacks.push(callback);return new Promise(()=>{});}}},document:{getElementById:()=>grid},location:{href:'https://shop.test/'},URL,Intl};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  let marketRenderVersion'),source.lastIndexOf('\n});')),context);
 const data={products:[{id:'1',handle:'dress',title:'Blue Dress',priceMin:10,images:[],tags:[],variants:[]}],globalSettings:{}};
 await context.renderProducts(data,'blue');
 assert.ok(grid.innerHTML.includes('Blue Dress'));assert.ok(grid.innerHTML.includes('See product price'));
 const old=callbacks[0];
 await context.renderProducts(data,'dress');
 old({priceMin:99,_marketPricingUnavailable:false},0);
 assert.equal(price.textContent,'');
 callbacks[1]({priceMin:10,variants:[{id:'2',price:25}],_marketPricingUnavailable:false},0);
 assert.equal(price.textContent,'$25.00');
});

test('the search endpoint supplies product suggestions using shop-filtered active results',async()=>{
 const code=(await transform(await fs.readFile('app/routes/api.search.jsx','utf8'),{loader:'jsx',format:'cjs'})).code;
 const mocks={
  "../utils/searchColor.js":searchColor,
  "../services/queryParser.server.js":{parseQuery:async()=>null},
  'react-router':{data:(value,init)=>Response.json(value,init)},
  '../utils/searchSuggestions.js':{buildSearchSuggestions},
  '../utils/spellingCorrection.js':{spellingCorrection},
  '../db.server':{__esModule:true,default:{}},
  '../services/merchandising.server':{getActivePinningRuleForSearch:async()=>null,getActiveRuleForSearch:async()=>null},
  '../services/meiliClient.server':{__esModule:true,default:{index:()=>({searchForFacetValues:async()=>({facetHits:[]})})}},
  '../services/suggestionBlacklist.server.js':{getActiveSuggestionBlacklist:async()=>[]},
  '../services/searchRanking.server.js':{},'../services/filterSettings.server':{},
  '../services/shopCache.server':{getCached:async()=>({})},
  '../services/rateLimiter.server':{rateLimit:async()=>true},
  '../services/semanticSearch.server':{semanticSearch:async(_query,options)=>{assert.ok(options.filter.includes("shop = 'fixture'"));assert.ok(options.filter.includes("status = 'ACTIVE'"));return {hits:[{id:'1',title:'Pleated Satin Evening Dress',status:'ACTIVE',options:[{name:'Color',values:['Blue']}],variantPrices:[],tags:[]}]};}},
 };
 const context={module:{exports:{}},exports:{},URL,Response,console,require:name=>{if(!(name in mocks))throw Error(name);return mocks[name];}};
 vm.runInNewContext(code,context);
 const response=await context.module.exports.loader({request:new Request('https://fixture/api/search?shop=fixture&q=blue%20dress')});
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()).suggestions,['Blue Pleated Satin Evening Dress']);
});

test('a stale phrase correction is hidden rather than replacing a natural language query',async()=>{
 const f=fixture();f.context.mainInput.value='blue plus size dress for wedding';
 f.context.fetch=async()=>({ok:true,json:async()=>({products:[{title:'Blue dress'}],didYouMean:'dress'})});
 await f.context.performSearch(f.context.mainInput.value);
 assert.equal(f.element('cfp-did-you-mean-container').style.display,'none');
});
test('a genuine spelling prompt never claims no products when results exist',async()=>{
 const f=fixture();f.context.mainInput.value='drees';
 f.context.fetch=async()=>({ok:true,json:async()=>({products:[{title:'Blue dress'}],didYouMean:'dress'})});
 await f.context.performSearch('drees');
 const banner=f.element('cfp-did-you-mean-container').innerHTML;
 assert.ok(banner.includes('Did you mean'));assert.ok(!banner.includes('nothing found'));assert.ok(!banner.includes('No matches found'));
});
