import http from 'node:http';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as searchColor from '../../app/utils/searchColor.js';
import * as availableVariants from '../../app/utils/availableVariants.js';
import {spellingCorrection} from '../../app/utils/spellingCorrection.js';
import {fetchCollectionPage} from '../../app/utils/collectionPage.js';
import * as ranked from '../../app/utils/rankedCollectionPage.js';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';
import {createCollectionPreparation,preparationRevisionKey,preparationKey} from '../../app/utils/collectionPreparation.js';
import {createShopCacheInvalidation,productRevisionKey} from '../../app/utils/shopCacheInvalidation.js';
import {processCollectionRankingJob} from '../../app/utils/processCollectionRankingJob.js';
import {createCollectionResponseCache,collectionPageFingerprint} from '../../app/utils/collectionResponse.js';
import * as collectionBootstrap from '../../app/utils/collectionBootstrap.js';
import * as collectionResponse from '../../app/utils/collectionResponse.js';

const shop='headless-fixture.myshopify.com';
export async function createLoadingServer({redisLayer}={}) {
  const values=new Map(),sessions=new Map(),jobs=new Map(),requests=[],configurationRequests=[],requestStarts=[];
  const state={delay:5500,priceDelay:2500,imageDelay:3000,pin:'1',boost:'2',fail:false,hold:false,builds:0,completed:0,revision:0,apiFailure:null,colorRule:false,early:false,assetDelay:0,apiDelay:0,clockOffset:0};
  let lastSpec;
  const trace={facetQueries:0,hydrations:0,documentBatches:0,documentCalls:0};
  const docs=Array.from({length:30},(_,i)=>({id:String(i+1),shop,title:`Fixture dress ${i+1}`,handle:`dress-${i+1}`,status:'ACTIVE',
    tags:[`product-${i+1}`],vendor:'Fixture',productType:'Dress',collections:['gid://shopify/Collection/1'],collection_titles:['Fixture collection'],
    bestSellingScore:i+1,createdAt:i+1,priceMin:i===2?0:i+1,priceMax:i+1,inventoryTotal:5,
    images:[`/image/${i+1}.svg`],options:[{name:'Color',values:['Blue']}],
    variantPrices:[{id:String((i+1)*100),price:i===2?0:i+1,compareAtPrice:null,available:true,option1:'Blue',imageUrl:`/image/${i+1}.svg`}]}));
  const byId=new Map(docs.map(p=>[p.id,p]));
  const select=options=>{
    let products=docs.filter(p=>p.status==='ACTIVE').map(p=>({...p}));
    const sort=options.sort?.[0];
    if(sort==='priceMin:asc')products.sort((a,b)=>a.priceMin-b.priceMin);
    else if(sort==='priceMin:desc')products.sort((a,b)=>b.priceMin-a.priceMin);
    else products.sort((a,b)=>b.bestSellingScore-a.bestSellingScore);
    return {hits:products.slice(options.offset||0,(options.offset||0)+(options.limit??25)),totalHits:products.length,estimatedTotalHits:products.length,facetDistribution:{},processingTimeMs:1};
  };
  const index={search:async(_q,options)=>select(options),
    getDocuments:async options=>{trace.documentBatches++;const ids=JSON.parse(options.filter.slice(6));const results=ids.map(id=>byId.get(String(id))).filter(doc=>doc&&doc.status!=='DELETED').map(doc=>({...doc})).reverse();trace.hydrations+=results.length;return {results,offset:0,limit:options.limit,total:results.length};},
    getDocument:async id=>{trace.documentCalls++;trace.hydrations++;const doc=byId.get(String(id));if(doc.status==='DELETED')throw Object.assign(Error('Missing'),{code:'document_not_found'});return {...doc};}};
  const prisma={product:{findMany:async({where})=>docs.filter(p=>p.status==='ACTIVE'&&(!where.id?.in||where.id.in.includes('gid://shopify/Product/'+p.id))).map(p=>({...p,id:'gid://shopify/Product/'+p.id,variants:p.variantPrices}))},variant:{groupBy:async()=>[]}};
  const serviceCtx={module:{exports:{}},exports:{},console:{log(){},error(){}},require:()=>({__esModule:true,default:prisma})};
  vm.runInNewContext((await transform(await fs.readFile('app/services/merchandising.server.js','utf8'),{format:'cjs'})).code,serviceCtx);
  const merch=serviceCtx.module.exports;
  const redis=redisLayer?.redis||{get:async key=>values.get(key),ttl:async()=>600,set:async(key,value)=>values.set(key,value),setex:async(key,_ttl,value)=>values.set(key,value),del:async(...keys)=>{keys.forEach(key=>values.delete(key));return keys.length;},incr:async key=>{const value=Number(values.get(key)||0)+1;values.set(key,String(value));return value;},scan:async()=>['0',[...values.keys()]]};
  let preparation;
  const timers=new Set();
  const queue=redisLayer?.queue||{getJob:async id=>jobs.get(id),add:async(name,data,{jobId,priority})=>{
    if(jobs.has(jobId))return jobs.get(jobId);
    const job={name,data,opts:{priority},state:'waiting',getState:async()=>job.state,remove:async()=>jobs.delete(jobId),changePriority:async({priority})=>job.opts.priority=priority};
    jobs.set(jobId,job);
    if(!state.hold){const timer=setTimeout(async()=>{timers.delete(timer);job.state='active';try{await dispatch(job);job.state='completed';state.completed++;}catch{job.state='failed';job.finishedOn=Date.now();}},name==='COLLECTION_RANKING_PREPARE'?state.delay:50);timers.add(timer);}
    return job;
  }};
  preparation=createCollectionPreparation({redis,queue,now:()=>Date.now()+state.clockOffset,prepare:async spec=>{state.builds++;if(state.fail)throw Error('Fixture engine failure');return prepareCollectionRanking(spec,{index,prisma,arrange:merch.applyMerchandisingRules,comparator:merch.createMerchandisingComparator});}});
  async function warm(shop,collectionIds){if(collectionIds&&!collectionIds.includes('1'))return;
    await routeCtx.module.exports.loader({request:new Request('http://fixture/api/filter?locale=en&shop='+shop+'&country=US&collectionHandle=fixture&sortBy=best-selling&page=1&limit=25'),params:{},context:{rankingWarmup:true}});
  }
  async function schedule(shop,collectionIds){const jobId='warm-'+shop+'-'+(collectionIds?.join('-')||'all');const job=await queue.getJob(jobId);if(job&&['active','waiting','prioritized','delayed'].includes(await job.getState()))return;if(job)await job.remove();await queue.add('COLLECTION_RANKING_WARM',{shop,collectionIds},{jobId,priority:10});}
  async function dispatch(job){return processCollectionRankingJob(job,{prepare:preparation.process,warm,schedule});}
  redisLayer?.setHandler(async job=>{if(job.name==='COLLECTION_RANKING_PREPARE')await new Promise(resolve=>setTimeout(resolve,state.delay));const result=await dispatch(job);state.completed++;return result;});
  const invalidate=createShopCacheInvalidation({redis,warm:schedule});
  const responseCache=createCollectionResponseCache({readRevision:async()=>[
    String(await redis.get(preparationRevisionKey(shop))??'0'),String(await redis.get(productRevisionKey(shop,'all'))??'0'),
  ]});
  const mocks={
    '../services/searchRanking.server.js':{},
    'react-router':{data:(value,init)=>Response.json(value,init)},'../db.server':{__esModule:true,default:prisma},
    '../services/merchandising.server':{...merch,getActivePinningRuleForCollection:async()=>({products:[{id:'gid://shopify/Product/'+state.pin}]}),
      getActiveRuleForCollection:async()=>({conditions:[state.colorRule?{field:'Color',action:'Boost',value:'Blue'}:{field:'Tags',action:'Boost',value:'product-'+state.boost,operator:'contains'}]})},
    '../services/filterSettings.server':{},'../services/meiliClient.server':{__esModule:true,default:{index:()=>index}},
    '../services/shopCache.server':{getCached:async(key,fn)=>key.startsWith('globalSettings:')?{prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true,showProductCount:true}:key.startsWith('mergedValues:')?[]:key.startsWith('filterGroup:')?{resolvedCollectionId:'gid://shopify/Collection/1',resolvedCollectionTitle:'Fixture collection',activeGroupFilters:[]}:fn()},
    '../shopify.server':{},'../services/rateLimiter.server':{rateLimit:async()=>true},
    '../services/collectionBestSelling.server.js':{getCollectionBestSellingState:async()=>({ids:state.orderVersion?docs.map(p=>p.id):docs.map(p=>p.id).reverse(),revision:'native-order-v'+(state.orderVersion||0),status:'ready',updatedAt:1+(state.orderVersion||0)})},
    '../utils/collectionPage.js':{fetchCollectionPage},'../utils/rankedCollectionPage.js':ranked,
    '../services/collectionRankingSession.server.js':{collectionRankingFingerprint:url=>{const u=new URL(url);u.searchParams.delete('page');u.searchParams.delete('rankingToken');u.searchParams.delete('responseProfile');u.searchParams.sort();return u.search;},
      getCollectionRankingSession:async(_shop,fingerprint,token)=>{if(!token)return null;const value=sessions.get(token);if(!value||value.fingerprint!==fingerprint)throw Error('Collection ranking session expired');return value;},
      saveCollectionRankingSession:async(_shop,fingerprint,ids,updatedAt,metadata)=>{const identity=JSON.stringify({fingerprint,ids,updatedAt,metadata});for(const value of sessions.values())if(JSON.stringify({fingerprint:value.fingerprint,ids:value.ids,updatedAt:value.updatedAt,metadata:value.metadata})===identity)return value;const token='fixture-token-'+sessions.size;const value={token,fingerprint,ids,updatedAt,metadata};sessions.set(token,value);return value;}},
    '../services/collectionPreparation.server.js':{getCollectionPreparationRevision:preparation.revision,getPreparedCollectionRanking:(spec,options)=>{lastSpec=spec;return preparation.get(spec,options);},discardPreparedCollectionRanking:preparation.discard,registerCollectionWarmup:async()=>{}},
    '../services/semanticSearch.server':{semanticMultiSearch:async queries=>{trace.facetQueries+=queries.length;return {results:queries.map(select)};}},
    '../utils/searchColor.js':searchColor,'../utils/availableVariants.js':availableVariants,'../utils/spellingCorrection.js':{spellingCorrection},
    '../utils/collectionBootstrap.js':collectionBootstrap,'../utils/collectionResponse.js':collectionResponse,
  };
  const routeCtx={module:{exports:{}},exports:{},URL,Response,responseCache,fixtureBootstrap:collectionBootstrap,fixtureResponse:collectionResponse,fixtureCollectionPageFingerprint:collectionPageFingerprint,console:{log(){},error(){}},require:name=>{if(!(name in mocks))throw Error('Unexpected fixture import '+name);return mocks[name];}};
  const source=(await fs.readFile('app/routes/api.filter.jsx','utf8')).replace('await import("../services/queryParser.server.js")','({parseQuery:()=>null})').replace("await import('../services/collectionResponse.server.js')",'({beginCollectionResponse:responseCache.begin,collectionPageFingerprint:fixtureCollectionPageFingerprint})').replace("await import('../utils/collectionBootstrap.js')",'fixtureBootstrap').replace("await import('../utils/collectionResponse.js')",'fixtureResponse');
  vm.runInNewContext((await transform(source,{loader:'jsx',format:'cjs'})).code,routeCtx);
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/collectionFilterPro.css"><style>body{margin:0;font:16px Arial}header{position:sticky;top:0;z-index:4;background:#fff;height:80px;border-bottom:1px solid}#mega-menu{position:absolute;top:80px;left:0;right:0;height:240px;background:#eee;display:none}#mega-menu.open{display:block}.cfp-v1-app-container{padding:16px;min-height:1600px}.cfp-main-content{width:100%}</style><script>window.Shopify={locale:'en',country:'US',currency:{active:'USD',rate:1},routes:{root:'/'}};window.collectionFilterProSettings={columns_desktop:4,columns_mobile:2};window.browserErrors=[];addEventListener('error',e=>browserErrors.push(e.message));addEventListener('unhandledrejection',e=>browserErrors.push(String(e.reason)));window.cardSnapshots=[];new MutationObserver(()=>{const cards=[...document.querySelectorAll('.cfp-product-card--reveal')];if(cards.length&&!window.inserted){window.inserted=true;cardSnapshots.push({at:performance.now(),cards:cards.length,imagesLoaded:cards.filter(c=>c.querySelector('img').complete&&c.querySelector('img').naturalWidth>0).length,pricesReady:cards.filter(c=>!c.innerText.includes('See product price')).length,delays:cards.slice(0,6).map(c=>getComputedStyle(c).animationDelay)})}}).observe(document.documentElement,{childList:true,subtree:true});</script></head><body><header><button id="menu-open" onclick="document.getElementById('mega-menu').classList.toggle('open')">Open mega menu</button><div id="mega-menu">Header mega menu</div></header><div class="cfp-v1-app-container"><div class="cfp-layout-wrapper"><div id="cfp-top-bar" class="cfp-top-bar"><div class="cfp-top-bar__left"><button id="cfp-drawer-trigger-btn">Filters</button><span class="cfp-product-count"></span></div><div class="cfp-top-bar__right"><div class="cfp-custom-sort"><div class="cfp-custom-sort__trigger" id="cfp-custom-sort-trigger"><span id="cfp-custom-sort-label">Best selling</span></div><div class="cfp-custom-sort__dropdown" id="cfp-custom-sort-dropdown"><div class="cfp-custom-sort__option" data-value="best-selling">Best selling</div><div class="cfp-custom-sort__option" data-value="price-ascending">Price low to high</div></div></div></div></div><aside id="cfp-sidebar" class="cfp-sidebar" data-shop="${shop}" data-collection-id="1" data-collection-handle="fixture" data-template-name="collection"><div class="cfp-sidebar__header"><button id="cfp-close-btn">Close</button></div><div class="cfp-sidebar__body"><div id="cfp-sidebar__filter-groups"></div></div><div class="cfp-sidebar__footer"><button id="cfp-apply-btn">Apply</button><button id="cfp-clear-btn">Clear</button></div></aside><main class="cfp-main-content"><div id="cfp-products-container" class="cfp-products-grid"></div></main></div></div><div id="cfp-overlay" class="cfp-overlay"></div><script src="/assets/marketPricing.js"></script><script src="/assets/collectionFilterPro.js"></script><script>API_DOMAIN=location.origin;</script></body></html>`;
  const liquid=await fs.readFile('extensions/theme-extension/snippets/collectionFilterPro.liquid','utf8');
  const start=liquid.indexOf('  (function() {',liquid.indexOf('Fire API request'));
  const inline=liquid.slice(start,liquid.indexOf('</script>',start)).replace('{{ shop.permanent_domain }}',shop).replace('{{ cfp_collection_handle }}','fixture').replace('{{ cfp_collection_id }}','1').replaceAll('{{ request.locale.iso_code }}','en').replaceAll("'https://aisearchfilter.webvory.com", "location.origin + '");
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    try{
      if(url.pathname==='/__control'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const updates=JSON.parse(Buffer.concat(chunks).toString()||'{}');
        if(updates.reset){for(const timer of timers)clearTimeout(timer);timers.clear();if(redisLayer)await redisLayer.reset();values.clear();sessions.clear();jobs.clear();responseCache.clear();requests.length=0;requestStarts.length=0;docs.forEach(doc=>doc.status='ACTIVE');delete state.stormTimer;Object.assign(state,{delay:100,priceDelay:50,imageDelay:50,pin:'1',boost:'2',fail:false,hold:false,builds:0,completed:0,revision:0,apiFailure:null});}
        for(const [key,value]of Object.entries(updates))if(!['reset','invalidate','stormCollection','stopStorm','corruptPrepared','expireTokens','archive','deleteProduct'].includes(key))state[key]=value;
        if(redisLayer){if(state.hold)await redisLayer.worker.pause();else redisLayer.worker.resume();}
        if(updates.invalidate){state.revision++;await invalidate(shop);}
        if(updates.corruptPrepared){await preparation.discard(lastSpec);await redis.set((await import('../../app/utils/collectionPreparation.js')).preparationKey(lastSpec),'{corrupt');}
        if(updates.expireTokens)sessions.clear();
        if(updates.archive)byId.get(updates.archive).status='ARCHIVED';
        if(updates.deleteProduct)byId.get(updates.deleteProduct).status='DELETED';
        if(updates.stormCollection){const timer=setInterval(()=>invalidate(shop,{kind:'products',collectionIds:[updates.stormCollection]}).catch(()=>{}),150);timers.add(timer);state.stormTimer=timer;}
        if(updates.stopStorm&&state.stormTimer){clearInterval(state.stormTimer);timers.delete(state.stormTimer);delete state.stormTimer;}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:{...state,stormTimer:!!state.stormTimer},requests}));return;
      }
      if(url.pathname==='/__state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:{...state,stormTimer:!!state.stormTimer},requests,configurationRequests,requestStarts,queueFailures:redisLayer?.failures||[],productRevision:await redis.get(productRevisionKey(shop,'1'))||'0'}));return;}
      if(url.pathname.startsWith('/assets/')){
        const name=url.pathname.split('/').pop();if(!['collectionFilterPro.js','collectionFilterPro.css','marketPricing.js'].includes(name)){res.writeHead(404).end();return;}
        if(name==='collectionFilterPro.css'&&state.cssDelay)await new Promise(resolve=>setTimeout(resolve,state.cssDelay));
        if(name==='collectionFilterPro.js'&&state.assetDelay)await new Promise(resolve=>setTimeout(resolve,state.assetDelay));
        res.setHeader('Content-Type',name.endsWith('css')?'text/css':'text/javascript');res.end(await fs.readFile('extensions/theme-extension/assets/'+name));return;
      }
      if(url.pathname==='/api/filter'){
        if(url.searchParams.get('responseProfile')!=='collection-config-v1')requestStarts.push({sort:url.searchParams.get('sortBy'),startedAt:Date.now()});
        if(state.apiDelay)await new Promise(resolve=>setTimeout(resolve,state.apiDelay));
        if(state.apiFailure==='html'){res.writeHead(502,{'Content-Type':'text/html'}).end('<html>Proxy unavailable</html>');return;}
        if(state.apiFailure==='empty'){res.writeHead(200,{'Content-Type':'application/json'}).end('{}');return;}
        const response=await routeCtx.module.exports.loader({request:new Request('http://fixture'+req.url,{headers:req.headers}),params:{},context:{}});
        const text=await response.text();const data=text?JSON.parse(text):{};
        const target=url.searchParams.get('responseProfile')==='collection-config-v1'?configurationRequests:requests;
        target.push({page:url.searchParams.get('page'),sort:url.searchParams.get('sortBy'),token:url.searchParams.get('rankingToken'),status:response.status,products:data.products?.length,first:data.products?.[0]?.id,ranking:data.debug?.collectionRankingStatus,revision:state.revision});
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(text);return;
      }
      if(url.pathname.startsWith('/products/')){
        const id=url.pathname.match(/dress-(\d+)/)?.[1];const doc=byId.get(id);await new Promise(resolve=>setTimeout(resolve,state.priceDelay));
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({price_min:doc.priceMin*100,price_max:doc.priceMax*100,variants:[{id:Number(id)*100,price:doc.priceMin*100,compare_at_price:null}]}));return;
      }
      if(url.pathname.startsWith('/image/')){
        await new Promise(resolve=>setTimeout(resolve,state.imageDelay));res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480"><rect width="360" height="480" fill="#b9cdee"/></svg>');return;
      }
      if(url.pathname.startsWith('/collections/')){res.setHeader('Content-Type','text/html');let body=html.replace('<style>body','<style>*,*::before,*::after{box-sizing:border-box}body');if(state.early){const earlyScript='<script>window.Shopify=window.Shopify||{locale:"en",country:"US"};'+inline+'</script>';body=state.earlyBeforeStyles?body.replace('<link rel="stylesheet"',earlyScript+'<link rel="stylesheet"'):body.replace('<script src="/assets/marketPricing.js">',earlyScript+'<script src="/assets/marketPricing.js">');}res.end(body);return;}
      res.writeHead(404).end();
    }catch(error){res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}
  });
  return {server,state,trace,load:(request,context={})=>routeCtx.module.exports.loader({request,context,params:{}}),
    prepareLast:()=>preparation.process({key:preparationKey(lastSpec),spec:lastSpec}),
    dispose(){for(const timer of timers)clearTimeout(timer);timers.clear();server.closeAllConnections();server.close();}};
}
