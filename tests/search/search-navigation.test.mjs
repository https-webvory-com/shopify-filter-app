import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import * as suggestions from '../../app/utils/searchSuggestions.js';
import * as blacklist from '../../app/utils/suggestionBlacklist.js';

test('collection metadata is tenant scoped and thumbnail URLs are safe',async()=>{
 const queries=[];
 const service=await loadModule('app/services/searchNavigation.server.js',{
  '../db.server.js':{default:{$queryRaw:async(strings,...values)=>{queries.push({sql:strings.join('?'),values});return [{id:'gid://shopify/Collection/1',title:'Prom',handle:'prom',images:[{src:'https://cdn.shopify.com/prom.jpg'}]},{id:'2',handle:'unsafe',images:['javascript:alert(1)']}];}}},
  './shopCache.server.js':{getCached:async(_key,read)=>read()},'./semanticSearch.server.js':{},'../utils/searchSuggestions.js':suggestions,
 });
 assert.equal((await service.searchCollectionCards('a.myshopify.com',{handles:['prom']}))[0].image,'https://cdn.shopify.com/prom.jpg');
 assert.equal((await service.searchCollectionCards('a.myshopify.com',{ids:['2']}))[1].image,'');
 assert.equal(queries[0].values.filter(value=>value==='a.myshopify.com').length,2);
 assert.match(queries[0].sql,/c.shop=\?/);assert.match(queries[0].sql,/p.shop=\?/);
 assert.equal((await service.searchCollectionCards('a.myshopify.com')).length,0);
});
test('collection discovery uses existing membership facets and never presents overlapping facet counts as totals',async()=>{
 const calls=[];
 const service=await loadModule('app/services/searchNavigation.server.js',{
  '../db.server.js':{default:{$queryRaw:async()=>[{id:'gid://shopify/Collection/1',title:'Prom',handle:'prom',images:[]}]}},
  './shopCache.server.js':{getCached:async(_key,read)=>read()},
  './semanticSearch.server.js':{keywordSearch:async(q,options)=>{calls.push({q,options});return {facetDistribution:{collections:{'gid://shopify/Collection/1':123}}};}},'../utils/searchSuggestions.js':suggestions,
 });
 const cards=await service.searchCollectionCandidates('a.myshopify.com','dress',{filter:["shop = 'a.myshopify.com'"],_cfpSearchSurface:true});
 assert.equal(cards[0].handle,'prom');assert.equal(cards[0].count,undefined);
 assert.deepEqual(Array.from(calls[0].options.facets),['collections']);assert.equal(calls[0].options.limit,0);assert.ok(calls[0].options._cfpSearchSurface);
});
test('popular searches aggregate successful queries across visitors and discard identifying or unsafe terms',async()=>{
 let query;
 const service=await loadModule('app/services/searchNavigation.server.js',{
  '../db.server.js':{default:{$queryRaw:async(strings,...values)=>{query={sql:strings.join('?'),values};return ['prom dress','person@example.com','123456789','<script>x</script>','wedding guest'].map(query=>({query}));}}},
  './shopCache.server.js':{getCached:async(_key,read)=>read()},'./semanticSearch.server.js':{},'../utils/searchSuggestions.js':suggestions,
 });
 assert.deepEqual(Array.from(await service.popularSearchQueries('a.myshopify.com')),['prom dress','wedding guest']);
 assert.match(query.sql,/COUNT\(DISTINCT "anonId"\)>=3/);assert.match(query.sql,/hits>0/);assert.ok(query.values.includes('a.myshopify.com'));
});
test('category tabs prefer matching merchant categories and omit internal index and All collections',async()=>{
 const cards=[['1','All'],['2','Smart Products Filter Index - Do not delete'],['3','Ultimate Search - Do not delete'],['4','Prom Dresses'],['5','Formal Dresses'],['6','Wedding Dresses']].map(([id,title])=>({id:'gid://shopify/Collection/'+id,title,handle:title.toLowerCase().replaceAll(' ','-'),images:[]}));
 const service=await loadModule('app/services/searchNavigation.server.js',{
  '../db.server.js':{default:{$queryRaw:async()=>cards}},'./shopCache.server.js':{getCached:async(_key,read)=>read()},
  './semanticSearch.server.js':{keywordSearch:async()=>({facetDistribution:{collections:Object.fromEntries(cards.map((card,index)=>[card.id,100-index]))}})},'../utils/searchSuggestions.js':suggestions,
 });
 const preferred=[cards[5],cards[4],cards[3],{id:'gid://shopify/Collection/999'}];
 const result=await service.searchCollectionCandidates('a.myshopify.com','dress',{},preferred);
 assert.deepEqual(Array.from(result,card=>card.title),['Wedding Dresses','Formal Dresses','Prom Dresses']);
 const automatic=await service.searchCollectionCandidates('a.myshopify.com','dress',{});
 assert.deepEqual(Array.from(automatic,card=>card.title),['Prom Dresses','Formal Dresses','Wedding Dresses']);
});
test('navigation endpoint validates handles and applies the shop suggestion blacklist',async()=>{
 let calls=0;
 const route=await loadModule('app/routes/api.search-navigation.jsx',{
  'react-router':{data:(body,init)=>Response.json(body,init)},'../services/rateLimiter.server':{rateLimit:async()=>true},
  '../services/searchNavigation.server.js':{searchCollectionCards:async()=>{calls++;return [];},popularSearchQueries:async()=>['prom dress','wedding guest']},
  '../services/suggestionBlacklist.server.js':{getActiveSuggestionBlacklist:async()=>[{term:'prom',operator:'contains'}]},'../utils/suggestionBlacklist.js':blacklist,
 });
 const invalid=await route.loader({request:new Request('https://app/api/search-navigation?shop=a.myshopify.com&handles=bad%22')});assert.equal(invalid.status,400);assert.equal(calls,0);
 const result=await route.loader({request:new Request('https://app/api/search-navigation?shop=a.myshopify.com')});assert.equal(result.status,200);assert.deepEqual((await result.json()).popularSearches,['wedding guest']);
});

test('category requests resolve only same-shop collections and retain query pinning, merchandising and exact totals',async()=>{
 const ranked=[],lookups=[];let direct,rules=true;
 const pin={id:'pin'},merch={id:'merch'};
 const route=await loadModule('app/routes/api.search.jsx',{
  '../services/queryParser.server.js':{parseQuery:async()=>({})},'../utils/searchColor.js':{},'../utils/spellingCorrection.js':{},'../utils/searchSuggestions.js':suggestions,
  '../services/suggestionBlacklist.server.js':{},'react-router':{data:(body,init)=>Response.json(body,init)},
  '../db.server':{default:{collection:{findFirst:async args=>{lookups.push(args);return args.where.handle==='prom'?{id:'gid://shopify/Collection/123'}:null;}},mergedValue:{findMany:async()=>[]}}},
  '../services/merchandising.server':{getActivePinningRuleForSearch:async()=>rules?pin:null,getActiveRuleForSearch:async()=>rules?merch:null},
  '../services/searchRanking.server.js':{rankSearchResults:async args=>{ranked.push(args);return {products:[],total:17};}},
  '../services/meiliClient.server':{default:{}},'../services/filterSettings.server':{getFilterGlobalSettings:async()=>({showOnlyInStock:true})},
  '../services/shopCache.server':{getCached:async(_key,read)=>read()},'../services/rateLimiter.server':{rateLimit:async()=>true},
  '../services/semanticSearch.server':{semanticSearch:async(_q,options)=>{direct=options;return {hits:[],totalHits:19,estimatedTotalHits:99};}},
 });
 const request=extra=>route.loader({request:new Request('https://app/api/search?shop=a.myshopify.com&q=dress&categoryCount=1&suggestionLimit=0&'+extra)});
 let response=await request('collection=prom');assert.equal(response.status,200);assert.equal((await response.json()).matchCount,17);
 assert.equal(lookups[0].where.shop,'a.myshopify.com');assert.equal(ranked[0].parsedQuery.searchCollectionId,'gid://shopify/Collection/123');
 assert.equal(ranked[0].pinningRule,pin);assert.equal(ranked[0].rule,merch);assert.ok(ranked[0].options.filter.includes('available = true'));
 assert.ok(ranked[0].options.filter.some(filter=>filter.includes('collections = "gid://shopify/Collection/123"')));
 response=await request('collection=another-shop-only');assert.equal((await response.json()).matchCount,0);assert.equal(ranked.length,1);
 response=await request('collection=bad%22');assert.equal(response.status,400);
 assert.equal(direct,undefined);
 rules=false;response=await request('collection=prom');assert.equal((await response.json()).matchCount,19,'use exact totalHits rather than estimatedTotalHits');
 assert.equal(direct.page,1);assert.equal(direct.hitsPerPage,1);assert.deepEqual(Array.from(direct.attributesToRetrieve),['id']);
});
