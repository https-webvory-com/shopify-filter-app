import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule,loadRanking} from './helpers/search-ranking.mjs';
import * as colors from '../../app/utils/searchColor.js';
import * as availableVariants from '../../app/utils/availableVariants.js';
import {spellingCorrection} from '../../app/utils/spellingCorrection.js';
import {buildSearchSuggestions} from '../../app/utils/searchSuggestions.js';
import {withSemanticSearch,semanticFallback,semanticProvider} from '../../app/utils/semanticSearch.js';
import {isProductCodeQuery,productMatchesCode,skuSearchWhere} from '../../app/utils/skuSearch.js';
import {compileSearchPagePlan} from '../../app/utils/searchPagePlan.js';
import * as projection from '../../app/utils/searchIndexProjection.js';

const shop='fixture.myshopify.com',gid=id=>'gid://shopify/Product/'+id;
const product=(id,sku,extra={})=>({id:String(id),shop,status:'ACTIVE',title:id===1?'Long Off Shoulder Sleeve Formal Couture Evening Dress':'Unrelated Dress '+id,
 handle:'dress-'+id,vendor:'Fixture',tags:[],priceMin:100,priceMax:100,images:['dress.jpg'],options:[{name:'Color',values:['Fuchsia']}],
 variantPrices:[{id:'v'+id,sku,available:true,price:100,option1:'Fuchsia',imageUrl:'dress.jpg'}],...extra});

async function fixture({pins=true}={}){
 const docs=[product(1,'1517-Fuchsia-4'),product(2,'15170-Fuchsia-4'),product(3,'11517-Fuchsia-4'),product(4,'1517-Fuchsia-4',{shop:'other.myshopify.com'}),product(5,'1517-Fuchsia-4',{status:'DRAFT'}),product(6,'OTHER-4')];
 const calls=[],dbCalls=[];
 const prisma={product:{findMany:async({where,select})=>{
  dbCalls.push(where);let rows=docs.filter(p=>p.shop===where.shop&&p.status.toLowerCase()===where.status.equals.toLowerCase());
  if(where.variants)rows=rows.filter(p=>p.variantPrices.some(v=>where.variants.some.OR.some(c=>c.sku.equals!==undefined?v.sku.toLowerCase()===c.sku.equals.toLowerCase():v.sku.toLowerCase().startsWith(c.sku.startsWith.replace(/\\([\\%_])/g,'$1').toLowerCase()))));
  if(where.id)rows=rows.filter(p=>where.id.in.includes(gid(p.id)));
  return rows.map(p=>select?{id:gid(p.id)}:{...p,id:gid(p.id),variants:p.variantPrices});
 }},mergedValue:{findMany:async()=>[]}};
 const parser=await loadModule('app/services/queryParser.server.js',{
  '../db.server':{default:prisma},'./shopCache.server.js':{getCached:async(_key,read)=>read()},
  './meiliClient.server.js':{default:{index:()=>({getFilterableAttributes:async()=>[],search:async()=>({facetDistribution:{}})})}},
  '../utils/searchColor.js':colors,
 });
 const search=async(q,options)=>{
  calls.push({q,options});
  const scope=(options.filter||[]).join(' '),ids=scope.match(/id IN (\[[^\]]*\])/);
  let hits=docs.filter(p=>p.shop===shop&&p.status==='ACTIVE');
  if(ids)hits=hits.filter(p=>JSON.parse(ids[1]).includes(p.id));
  if(q)hits=hits.filter(p=>productMatchesCode(p,q));
  if(scope.includes('available = true'))hits=hits.filter(p=>p.variantPrices.some(v=>v.available));
  const total=hits.length;hits=hits.slice(options.offset||0,(options.offset||0)+(options.limit??25));
  return {hits,totalHits:total,estimatedTotalHits:total,facetDistribution:{},facetStats:{}};
 };
 const ranking=await loadRanking(prisma,search);
 const pinning=pins?{name:'All Searches',products:[{id:gid(6)},{id:gid(1)}]}:null;
 const merchandising={...ranking.merchandising,getActivePinningRuleForSearch:async()=>pinning,getActiveRuleForSearch:async()=>null};
 const cache=async(key,read)=>key.startsWith('globalSettings:')?{}:key.startsWith('mergedValues:')?[]:key.startsWith('filterGroup:')?{resolvedCollectionId:null,resolvedCollectionTitle:'',activeGroupFilters:[]}:read();
 const common={
  'react-router':{data:(v,init)=>Response.json(v,init)},'../db.server':{default:prisma},
  '../services/merchandising.server':merchandising,'../services/searchRanking.server.js':ranking,
  '../utils/searchColor.js':colors,'../utils/availableVariants.js':availableVariants,
  '../utils/spellingCorrection.js':{spellingCorrection},'../utils/searchSuggestions.js':{buildSearchSuggestions},
  '../services/filterSettings.server':{},'../services/shopCache.server':{getCached:cache},
  '../services/rateLimiter.server':{rateLimit:async()=>true},'../services/suggestionBlacklist.server.js':{getActiveSuggestionBlacklist:async()=>[]},
  '../services/meiliClient.server':{default:{index:()=>({searchForFacetValues:async()=>({facetHits:[]})})}},
  '../services/semanticSearch.server':{semanticSearch:search,semanticMultiSearch:async queries=>({results:await Promise.all(queries.map(q=>search(q.q,q)))})},
  '../utils/rankedCollectionPage.js':{},'../utils/collectionPage.js':{},'../shopify.server':{},
  '../services/collectionBestSelling.server.js':{},'../services/collectionPreparation.server.js':{},
  '../services/collectionRankingSession.server.js':{collectionRankingFingerprint:()=>''},
 };
 return {parser,calls,dbCalls,load:async(q,surface,page=1)=>{
  const parsed=await parser.parseQuery(q,shop);
  const route=await loadModule(surface==='instant'?'app/routes/api.search.jsx':'app/routes/api.filter.jsx',{
   ...common,testParsedQuery:parsed,'../services/queryParser.server.js':{parseQuery:async()=>parsed},
  });
  const response=await route.loader({request:new Request('https://fixture/api/'+(surface==='instant'?'search':'filter')+'?'+new URLSearchParams({shop,isSearch:'true',q,limit:'25',page:String(page)}))});
  const body=await response.json();assert.equal(response.status,200,body.error);return body;
 }};
}

test('SKU parser resolves the 1517 model prefix without 15170, embedded digits, other shops or inactive products',async()=>{
 const f=await fixture();
 for(const q of ['1517','1517-FUCHSIA-4']){
  const parsed=await f.parser.parseQuery(q,shop);assert.deepEqual(Array.from(parsed.skuProductIds),['1']);assert.equal(parsed.colorIntent.requested.length,0);
 }
 assert.equal(f.dbCalls[0].shop,shop);assert.equal(f.dbCalls[0].variants.some.OR[0].sku.equals,'1517');
});

test('SKU prefix delimiters and underscores are literal in PostgreSQL LIKE patterns',()=>{
 const where=skuSearchWhere(shop,'AB_1517');
 assert.equal(where.variants.some.OR[0].sku.equals,'AB_1517');
 assert.deepEqual(where.variants.some.OR.slice(1).map(c=>c.sku.startsWith),['AB\\_1517-','AB\\_1517\\_','AB\\_1517/','AB\\_1517 ']);
});

test('numbered shopping phrases are not treated as model codes',()=>{
 for(const query of ['2 Piece Short Prom Dresses','8th Grade Graduation Dresses','90s Prom Dresses','2-piece short prom dresses']) {
  assert.equal(isProductCodeQuery(query),false,query);
  assert.ok(withSemanticSearch({q:query},true).hybrid,query);
 }
});

for(const surface of ['instant','page'])for(const query of ['2 Piece Short Prom Dresses','8th Grade Graduation Dresses','90s Prom Dresses'])test(surface+' keeps explicit pins for '+query,async()=>{
 const f=await fixture(),body=await f.load(query,surface);
 assert.deepEqual(body.products.map(p=>p.id),[gid(6),gid(1)]);
 assert.ok(f.dbCalls.every(where=>!where.variants),'a descriptive query does not trigger exact SKU resolution');
});

for(const pins of [false,true])for(const surface of ['instant','page'])test(surface+' SKU 1517 returns only its product with pins='+pins,async()=>{
 const f=await fixture({pins}),body=await f.load('1517',surface);
 assert.deepEqual(body.products.map(p=>p.id),[gid(1)]);assert.equal(body.totalCount,1);
 assert.ok(f.calls.every(c=>c.q===''));assert.ok(f.calls.every(c=>c.options.filter.some(s=>s.includes('id IN ["1"]'))));
 if(surface==='page'){const next=await f.load('1517',surface,2);assert.equal(next.totalCount,1);assert.equal(next.products.length,0);}
});

for(const surface of ['instant','page'])test(surface+' unknown SKU cannot inject unrelated All Searches pins',async()=>{
 const f=await fixture();const body=await f.load('999999',surface);assert.equal(body.totalCount,0);assert.equal(body.products.length,0);
});

test('model codes stay lexical across semantic single, batch and keyword retrieval',async()=>{
 for(const q of ['1517','1517-Fuchsia-4','AB1517','1517-Steel Blue-4','1517-Steel Blue-XL']){
  assert.equal(isProductCodeQuery(q),true);assert.equal(withSemanticSearch({q},true).hybrid,undefined);
 }
 assert.ok(withSemanticSearch({q:'red wedding dress size 4'},true).hybrid);
 const calls=[];
 const service=await loadModule('app/services/semanticSearch.server.js',{
  './meiliClient.server':{default:{index:()=>({getEmbedders:async()=>({openai:{source:'openAi'}}),search:async(q,options)=>{calls.push({q,...options});return {hits:[]};}}),multiSearch:async({queries})=>{calls.push(...queries);return {results:queries.map(()=>({hits:[]}))};}}},
  './shopCache.server':{getCached:async(_key,read)=>read()},'../utils/semanticSearch.js':{withSemanticSearch,semanticFallback,semanticProvider},
 });
 await service.semanticSearch('1517',{filter:["shop = 'fixture'"]});await service.keywordSearch('1517',{});
 await service.semanticMultiSearch([{q:'1517'}]);assert.equal((await service.searchPageBatch([{q:'1517'}])).semantic,false);
 assert.equal(calls.length,4);assert.ok(calls.every(c=>!c.hybrid&&c.matchingStrategy==='all'));
});

test('native search distinguishes numbered shopping phrase pins from SKU/model lookups',async()=>{
 const docs=[product(1,'1517-Fuchsia-4'),product(6,'OTHER-4')];
 const service=await loadModule('app/services/nativeSearchPage.server.js',{
  './meiliClient.server':{default:{index:()=>({getSettings:async()=>({filterableAttributes:['*']}),search:async()=>({totalHits:0})})}},
  '../db.server':{default:{product:{findMany:async()=>docs.map(p=>({...p,id:gid(p.id),variants:p.variantPrices}))}}},
  './shopCache.server':{getCached:async(_key,read)=>read()},
  './semanticSearch.server':{searchPageBatch:async queries=>({semantic:false,results:queries.map(()=>({totalHits:0}))})},
  '../utils/searchPagePlan.js':{compileSearchPagePlan},'../utils/searchIndexProjection.js':projection,
  './merchandising.server':{buildMeiliIncludeFilters:()=>[],applyMerchandisingRules:p=>p,selectMerchandisingVariant:()=>null},
  '../utils/searchColor.js':colors,
 });
 const spec={shop,options:{filter:["shop = 'fixture.myshopify.com'",'id IN ["1"]']},pinningRule:{products:[{id:gid(6)},{id:gid(1)}]},facetKeys:['vendor']};
 const known=await service.rankNativeSearchPage({...spec,query:'',parsedQuery:{skuProductIds:['1']}});
 assert.equal(known.total,1);assert.deepEqual(Array.from(known.products,p=>p.id),[gid(1)]);assert.equal(known.facetDistribution.vendor.Fixture,1);
 const missing=await service.rankNativeSearchPage({...spec,query:'999999'});assert.equal(missing.total,0);assert.equal(missing.products.length,0);
 const phrase=await service.rankNativeSearchPage({...spec,query:'2 Piece Short Prom Dresses',options:{filter:["shop = 'fixture.myshopify.com'"]}});
 assert.equal(phrase.total,2);assert.equal(phrase.pinnedCount,2);
 assert.deepEqual(Array.from(phrase.products,p=>p.id),[gid(6),gid(1)]);
 assert.equal(phrase.facetDistribution.vendor.Fixture,2);
});
