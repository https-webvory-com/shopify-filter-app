import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule,loadRanking} from './helpers/search-ranking.mjs';
import * as variants from '../../app/utils/availableVariants.js';
import * as color from '../../app/utils/searchColor.js';
import {spellingCorrection} from '../../app/utils/spellingCorrection.js';

test('filtered search uses one market-priced Red/M variant across all sorts and final pages',async()=>{
 const shop='fixture.myshopify.com',contexts=[],cache=new Map();
 const variant=(id,amount,option1='Red',option2='M',available=true)=>({id:String(id),price:75,available,option1,option2,marketPrices:{IN:{price:amount,currency:'INR'}},imageUrl:'dress.jpg'});
 const options=[{name:'Color',values:['Red','Blue']},{name:'Size',values:['M','L']}];
 const docs=Array.from({length:28},(_,i)=>({id:String(i+1),shop,status:'ACTIVE',title:'Prom '+i,handle:'prom-'+i,options,priceMin:75,images:['dress.jpg'],variantPrices:[variant('blue-'+i,5000,'Blue','M'),variant('red-l-'+i,7000,'Red','L'),variant(i+100,7000),variant('red-expensive-'+i,9600)]}));
 docs[0].priceMin=15;
 docs.push({id:'99',shop,status:'ACTIVE',title:'B8402',handle:'b8402',options,priceMin:75,images:['dress.jpg'],variantPrices:[variant('63954324390259',9600),variant('2',7000,'Red','L'),variant('3',7000,'Blue','M')]});
 const productModel={findMany:async()=>docs.map(p=>({...p,variants:p.variantPrices}))};
 const search=async(_q,o)=>{
  let hits=docs.map(p=>structuredClone(p));
  for(const clause of o.filter||[]){const match=typeof clause==='string'&&clause.match(/^id IN (\[.*\])$/);if(match){const ids=JSON.parse(match[1]);hits=hits.filter(p=>ids.includes(p.id));}}
  return {hits:hits.slice(o.offset||0,(o.offset||0)+(o.limit||1000)),totalHits:hits.length};
 };
 const cached=async(key,read)=>{if(key.startsWith('globalSettings'))return {showOnlyInStock:true,hideUnavailableVariantsWhenSelected:true,prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true};if(key.startsWith('mergedValues'))return [];if(key.startsWith('filterGroup'))return {resolvedCollectionId:null,resolvedCollectionTitle:'',activeGroupFilters:[]};if(!cache.has(key))cache.set(key,await read());return cache.get(key);};
 const service=await loadRanking({product:productModel},search,cached);
 const route=await loadModule('app/routes/api.filter.jsx',{
  'react-router':{data:(v,init)=>Response.json(v,init)},'../db.server':{default:{product:productModel}},
  '../services/searchRanking.server.js':service,'../services/merchandising.server':{...service.merchandising,getActivePinningRuleForSearch:async()=>({products:[{id:'gid://shopify/Product/99'}]}),getActiveRuleForSearch:async()=>({conditions:[{action:'Exclude',field:'Price',minValue:0,maxValue:20}]})},
  '../utils/searchColor.js':color,'../utils/availableVariants.js':{...variants,availableProductIds:async(model,where,filters,merged,range,config)=>{contexts.push(config.priceContext);return variants.availableProductIds(model,where,filters,merged,range,config);}},
  '../utils/spellingCorrection.js':{spellingCorrection},'../utils/rankedCollectionPage.js':{},'../utils/collectionPage.js':{},
  '../services/semanticSearch.server':{semanticMultiSearch:async()=>{throw Error('Unexpected ordinary search');}},
  '../services/meiliClient.server':{},'../services/filterSettings.server':{},'../shopify.server':{},
  '../services/rateLimiter.server':{rateLimit:async()=>true},'../services/collectionBestSelling.server.js':{},
  '../services/collectionPreparation.server.js':{},'../services/collectionRankingSession.server.js':{collectionRankingFingerprint:()=>''},
  '../services/shopCache.server':{getCached:cached},
 });
 let baseline;
 for(const sortBy of ['best-selling','price-ascending','price-descending','trending','created-descending']){
  const ids=[];
  for(const page of [1,2,3]){
   const url=new URL('https://fixture/api/filter');
   for(const [key,value] of Object.entries({shop,isSearch:'true',q:'prom',country:'IN',priceFilterVersion:'1',priceSortRate:'95',minPrice:'59',maxPrice:'99','options[Color][]':'Red','options[Size][]':'M',sortBy,page,limit:25}))url.searchParams.set(key,String(value));
   const response=await route.loader({request:new Request(url)}),body=await response.json();
   assert.equal(response.status,200,body.error);assert.equal(body.totalCount,27);
   assert.equal(body.products.length,page===1?25:page===2?2:0);
   for(const p of body.products){
    assert.equal(p.variants.length,4,'other colors, sizes and out-of-band prices remain choices');
    assert.equal(new Set(p.variants.map(v=>v.id)).size,4);
    const selected=p.variants.find(v=>v.id.split('/').pop()===String(p.selectedVariantId).split('/').pop());
    assert.ok(selected);assert.equal(selected.option1,'Red');assert.equal(selected.option2,'M');assert.equal(selected.price,7000);
    assert.equal(p.variants[0].id,selected.id,'the eligible selection is the default card variant');
    assert.deepEqual(p.options[0].values,['Red','Blue']);
    assert.ok(p.variants.some(v=>v.option1==='Blue'&&v.price===5000));
    assert.ok(p.variants.some(v=>v.price===9600));
   }
   ids.push(...body.products.map(p=>p.id));
  }
  assert.equal(new Set(ids).size,27);const set=ids.slice().sort();baseline ||= set;assert.deepEqual(set,baseline);
 }
 assert.ok(contexts.length);assert.ok(contexts.every(c=>c.country==='IN'&&c.requirePrice&&c.stockOnly&&!('direction' in c)));
});
