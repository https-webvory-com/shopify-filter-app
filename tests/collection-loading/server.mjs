import * as extraProductFilters from '../../app/utils/extraProductFilters.js';
import * as savedMarketPricing from '../../app/utils/savedMarketPricing.js';
import * as collectionPriceCandidates from '../../app/utils/collectionPriceCandidates.js';
import * as percentSaleFilter from '../../app/utils/percentSaleFilter.js';
import http from 'node:http';
import {gunzipSync} from 'node:zlib';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform,build} from 'esbuild';
import * as searchColor from '../../app/utils/searchColor.js';
import * as productTitleFilter from '../../app/utils/productTitleFilter.js';
import * as filterPresentation from '../../app/utils/filterPresentation.js';
import * as collectionNavigation from '../../app/utils/collectionNavigation.js';
import * as marketAvailability from '../../app/utils/marketAvailability.js';
import * as collectionFilterMembership from '../../app/utils/collectionFilterMembership.js';
import * as availableVariants from '../../app/utils/availableVariants.js';
import * as facetNormalization from '../../app/utils/facetNormalization.js';
import * as searchCachePolicy from '../../app/utils/searchCachePolicy.js';
import {spellingCorrection} from '../../app/utils/spellingCorrection.js';
import {fetchCollectionPage} from '../../app/utils/collectionPage.js';
import * as ranked from '../../app/utils/rankedCollectionPage.js';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';
import {validateCollectionReuse} from '../../app/utils/validateCollectionReuse.js';
import {createCollectionCandidateIndex} from '../../app/utils/collectionCandidateIndex.js';
import {createCollectionFactProfile,projectCollectionRuleFacts} from '../../app/utils/collectionRuleFacts.js';
import {createCollectionPreparation,preparationRevisionKey,preparationKey} from '../../app/utils/collectionPreparation.js';
import {createShopCacheInvalidation,productRevisionKey} from '../../app/utils/shopCacheInvalidation.js';
import {processCollectionRankingJob} from '../../app/utils/processCollectionRankingJob.js';
import {createCollectionWarmupScheduler} from '../../app/utils/collectionWarmupScheduler.js';
import {createCollectionDependencies} from '../../app/utils/collectionDependencies.js';
import {decodePreparation} from '../../app/utils/collectionPreparationPayload.js';
import {createCollectionResponseCache,collectionPageFingerprint} from '../../app/utils/collectionResponse.js';
import * as collectionBootstrap from '../../app/utils/collectionBootstrap.js';
import * as collectionResponse from '../../app/utils/collectionResponse.js';
import * as collectionCards from '../../app/utils/collectionCards.js';
import {validateCollectionCardDocuments} from '../../app/utils/collectionCardValidation.js';
import * as pinnedPrefix from '../../app/utils/collectionPinnedPrefix.js';
import {createCollectionCardStore} from '../../app/utils/collectionCardStore.js';
import {createPublishedCollectionPages} from '../../app/utils/collectionPublishedPage.js';
import {createCollectionHeadProofs} from '../../app/utils/collectionHeadProofs.js';
import {createHash} from 'node:crypto';

const shop='headless-fixture.myshopify.com';
export async function createLoadingServer({redisLayer,savedPricePage,database}={}) {
  const values=new Map(),sessions=new Map(),jobs=new Map(),requests=[],configurationRequests=[],requestStarts=[],facetRequests=[];
  const savedPriceReads=new Map();
  const state={delay:5500,priceDelay:2500,imageDelay:3000,pin:'1',boost:'2',fail:false,hold:false,builds:0,completed:0,revision:0,apiFailure:null,colorRule:false,early:false,assetDelay:0,apiDelay:0,clockOffset:0};
  let lastSpec;
  const headEvents=[];
  const trace={facetQueries:0,hydrations:0,documentBatches:0,documentCalls:0,candidateBrowses:0,membershipBrowses:0};
  const makeDoc=(_,i)=>({id:String(i+1),shop,title:`Fixture dress ${i+1}`,handle:`dress-${i+1}`,status:'ACTIVE',
    tags:[`product-${i+1}`],vendor:'Fixture',productType:'Dress',collections:['gid://shopify/Collection/1'],collection_titles:['Fixture collection'],
    bestSellingScore:i+1,createdAt:i+1,priceMin:i===2?0:i+1,priceMax:i+1,
    marketPriceMin_US:i===2?0:i+1,marketAvailablePriceMin_US:i===2?0:i+1,inventoryTotal:5,
    images:[`/image/${i+1}.svg`],options:[{name:'Color',values:['Blue']}],
    variantPrices:[{id:String((i+1)*100),price:i===2?0:i+1,compareAtPrice:null,available:true,option1:'Blue',imageUrl:`/image/${i+1}.svg`}]});
  const docs=Array.from({length:30},makeDoc);
  const byId=new Map(docs.map(p=>[p.id,p]));
  const select=options=>{
    let products=docs.filter(p=>p.status==='ACTIVE').map(p=>({...p}));
    if(state.noMatchQuery && options.q===state.noMatchQuery)products=[];
    for(const filter of [options.filter || []].flat(Infinity)){
      if(typeof filter==='string'&&filter.startsWith('id IN ')) { const ids=JSON.parse(filter.slice(6));products=products.filter(p=>ids.includes(p.id)); }
      if(filter==='id = "__no_sale_match__"'||filter==='id = "__no_extra_filter_match__"'||filter==='id = "__no_eligible_price_variant__"')products=[];
      if(typeof filter==='string'){
        const fieldMatch=filter.match(/^(vendor|productType|collection_titles|tags|option_[^ ]+|metafield_[^ ]+) IN (\[.*\])$/);
        if(fieldMatch){const [,field,raw]=fieldMatch;let values;try{values=JSON.parse(raw);}catch{values=[...raw.matchAll(/'((?:\\.|[^'])*)'/g)].map(m=>m[1].replace(/\\'/g,"'").replace(/\\\\/g,'\\'));}
          products=products.filter(p=>{const value=field.startsWith('option_')?p.options.find(o=>o.name===field.slice(7))?.values:p[field];return (Array.isArray(value)?value:[value]).some(v=>values.includes(v));});}
        if(filter.startsWith('priceMin >= ')||filter.startsWith('priceMin <= ')||filter.startsWith('((priceMin >= ')){
          const ranges=[...filter.matchAll(/priceMin >= ([\d.]+)(?: AND priceMin <= ([\d.]+))?/g)].map(m=>[Number(m[1]),m[2]?Number(m[2]):Infinity]);
          if(ranges.length)products=products.filter(p=>ranges.some(([min,max])=>p.priceMin>=min&&p.priceMin<=max));
        }
        if(filter==='available = true'||filter==='available = false')products=products.filter(p=>p.variantPrices.some(v=>v.available)===(filter==='available = true'));
      }
      if(typeof filter==='string'&&filter.startsWith('title IN ')){
        const titles=JSON.parse(filter.slice('title IN '.length));products=products.filter(p=>titles.includes(p.title));
      }
    }
    const sort=options.sort?.[0];
    const priceSort=sort?.match(/^((?:availablePrice|price)(?:Min|Max)|market(?:Available)?Price(?:Min|Max)_[A-Z]{2}):(asc|desc)$/);
    if(priceSort){const [,field,direction]=priceSort;products.sort((a,b)=>(Number(a[field])-Number(b[field]))*(direction==='asc'?1:-1));}
    else if(sort==='title:asc'||sort==='title:desc')products.sort((a,b)=>a.title.localeCompare(b.title)*(sort.endsWith(':asc')?1:-1));
    else if(sort==='createdAt:asc'||sort==='createdAt:desc')products.sort((a,b)=>(a.createdAt-b.createdAt)*(sort.endsWith(':asc')?1:-1));
    else products.sort((a,b)=>b.bestSellingScore-a.bestSellingScore);
    const facetDistribution=options.facets?.includes('vendor')?{vendor:{Fixture:products.length}}:{};
    for(const field of options.facets||[]){
      if(['vendor','productType','tags','available'].includes(field)||field.startsWith('metafield_')||field.startsWith('option_')){
        facetDistribution[field]={};for(const p of products){const raw=field.startsWith('option_')?p.options.find(o=>o.name===field.slice(7))?.values:field==='available'?p.variantPrices.some(v=>v.available):p[field];for(const value of new Set((Array.isArray(raw)?raw:[raw]).filter(v=>v!=null)))facetDistribution[field][value]=(facetDistribution[field][value]||0)+1;}
      }
    }
    if(options.facets?.includes('title')){
      facetDistribution.title={};for(const p of products)facetDistribution.title[p.title]=(facetDistribution.title[p.title]||0)+1;
    }
    if(options.facets?.includes('collection_titles')){
      facetDistribution.collection_titles={};for(const p of products)for(const title of p.collection_titles)facetDistribution.collection_titles[title]=(facetDistribution.collection_titles[title]||0)+1;
    }
    if(options.facets?.includes('option_Color')){
      facetDistribution.option_Color={};
      for(const p of products){const position=p.options.findIndex(o=>o.name==='Color');for(const value of new Set(p.variantPrices.map(v=>v['option'+(position+1)]).filter(Boolean)))facetDistribution.option_Color[value]=(facetDistribution.option_Color[value]||0)+1;}
    }
    return {hits:products.slice(options.offset||0,(options.offset||0)+(options.limit??25)),totalHits:products.length,estimatedTotalHits:products.length,facetDistribution,processingTimeMs:1,...(options.facets?.includes('priceMin')&&products.length?{facetStats:{priceMin:{min:Math.min(...products.map(p=>p.priceMin)),max:Math.max(...products.map(p=>p.priceMin))}}}:{})};
  };
  const index={search:async(_q,options)=>select(options),
    getFilterableAttributes:async()=>['id'],
    getSettings:async()=>({distinctAttribute:null,pagination:{maxTotalHits:100000}}),
    getDocuments:async options=>{trace.documentBatches++;
      if(Array.isArray(options.filter)){
        trace.membershipBrowses++;
        const selected=select({filter:options.filter,limit:docs.length}).hits;
        const results=selected.slice(options.offset||0,(options.offset||0)+options.limit)
          .map(p=>Object.fromEntries(options.fields.filter(k=>k in p).map(k=>[k,p[k]])));
        return {results,total:selected.length};
      }
      if(typeof options.filter!=='string'||!options.filter.startsWith('id IN ')){
        trace.candidateBrowses++;const rows=docs.filter(p=>p.status==='ACTIVE');return {results:rows.slice(options.offset||0,(options.offset||0)+options.limit).map(p=>Object.fromEntries(options.fields.filter(k=>k in p).map(k=>[k,p[k]]))),total:rows.length};
      }
      const ids=JSON.parse(options.filter.slice(6));const results=ids.map(id=>byId.get(String(id))).filter(doc=>doc&&doc.status!=='DELETED').map(doc=>({...doc})).reverse();trace.hydrations+=results.length;return {results,offset:0,limit:options.limit,total:results.length};},
    getDocument:async id=>{trace.documentCalls++;trace.hydrations++;const doc=byId.get(String(id));if(doc.status==='DELETED')throw Object.assign(Error('Missing'),{code:'document_not_found'});return {...doc};}};
  const prisma={$queryRaw:async(strings,...values)=>{
    if(database)return database.$queryRaw(strings,...values);
    if(strings.join('?').includes('AS preorder'))return docs.filter(p=>p.status==='ACTIVE').map(p=>({id:p.id,available:true,onhand:true,preorder:false,rating:null,facts:null,...(state.extraFacts?.[p.id]||{})}));
    if (!strings.join('?').includes('AS percent') || values[0] !== shop) throw Error('Unexpected fixture SQL');
    return docs.filter(p=>p.status==='ACTIVE').map(p=>({id:p.id,percent:(state.salePercentages || {})[p.id] ?? 0}));
  },product:{findMany:async({where})=>docs.filter(p=>p.status==='ACTIVE'&&(!where.id?.in||where.id.in.includes('gid://shopify/Product/'+p.id))).map(p=>({...p,id:'gid://shopify/Product/'+p.id,variants:p.variantPrices}))},variant:{groupBy:async()=>[]},collection:{findMany:async({where})=>(state.collectionLinks||[{shop,title:'Fixture collection',handle:'fixture'}]).filter(row=>row.shop===where.shop&&where.title.in.includes(row.title))}};
  if(database)prisma.$transaction=database.$transaction.bind(database);
  const serviceCtx={module:{exports:{}},exports:{},console:{log(){},error(){}},require:()=>({__esModule:true,default:prisma})};
  vm.runInNewContext((await transform(await fs.readFile('app/services/merchandising.server.js','utf8'),{format:'cjs'})).code,serviceCtx);
  const merch=serviceCtx.module.exports;
  const redis=redisLayer?.redis||{get:async key=>values.get(key),ttl:async()=>600,set:async(key,value,mode)=>{if(mode==='NX'&&values.has(key)||mode==='XX'&&!values.has(key))return;values.set(key,value);},setex:async(key,_ttl,value)=>values.set(key,value),del:async(...keys)=>{keys.forEach(key=>values.delete(key));return keys.length;},incr:async key=>{const value=Number(values.get(key)||0)+1;values.set(key,String(value));return value;},scan:async()=>['0',[...values.keys()]]};
  const dependencies=createCollectionDependencies(redis);
  const headVersion=async spec=>createHash('sha256').update(JSON.stringify([preparationKey(spec),state.revision,state.orderVersion||0])).digest('hex');
  const headProofs=createCollectionHeadProofs({redis,readVersion:headVersion,observe:event=>headEvents.push(event)});
  let preparation;
  const timers=new Set();
  const queue=redisLayer?.queue||{getJob:async id=>jobs.get(id),add:async(name,data,{jobId,priority})=>{
    if(jobs.has(jobId))return jobs.get(jobId);
    const job={name,data,opts:{priority},state:'waiting',getState:async()=>job.state,remove:async()=>jobs.delete(jobId),changePriority:async({priority})=>job.opts.priority=priority};
    jobs.set(jobId,job);
    if(!state.hold){const timer=setTimeout(async()=>{timers.delete(timer);job.state='active';try{await dispatch(job);job.state='completed';state.completed++;}catch{job.state='failed';job.finishedOn=Date.now();}},name==='COLLECTION_RANKING_PREPARE'?state.delay:50);timers.add(timer);}
    return job;
  }};
  preparation=createCollectionPreparation({redis,queue,dependencies,now:()=>Date.now()+state.clockOffset,
    revalidateSaved:true,
    validateReuse:(spec,value)=>validateCollectionReuse(index,spec,value),
    prepareDirect:async spec=>{
      if(!state.directFacts)return null;
      const profile=createCollectionFactProfile(spec.rule.conditions,spec.mergedValues);
      return prepareCollectionRanking(spec,{index:createCollectionCandidateIndex(index,spec),prisma,arrange:merch.applyMerchandisingRules,comparator:merch.createMerchandisingComparator,
        factProfile:profile,loadFacts:async products=>{for(const p of products)Object.assign(p,projectCollectionRuleFacts(byId.get(p.id.split('/').pop()),profile,merch.checkRuleMatch,{backfill:true}));}});
    },
    prepare:async spec=>{state.builds++;if(state.fail)throw Error('Fixture engine failure');return prepareCollectionRanking(spec,{index,prisma,arrange:merch.applyMerchandisingRules,comparator:merch.createMerchandisingComparator});}});
  async function warm(shop,collectionIds,precompute=false){if(collectionIds&&!collectionIds.includes('1'))return;
    const response=await routeCtx.module.exports.loader({request:new Request('http://fixture/api/filter?locale=en&shop='+shop+'&country=US&collectionHandle=fixture&sortBy=best-selling&page=1&limit=25'),params:{},context:{rankingWarmup:true,rankingPrecompute:precompute}});
    if(precompute&&!(await response.json()).warmup)throw Error('Fixture precomputation did not complete');
  }
  const schedule=createCollectionWarmupScheduler(queue);
  async function dispatch(job){return processCollectionRankingJob(job,{prepare:preparation.process,warm,schedule});}
  redisLayer?.setHandler(async job=>{if(job.name==='COLLECTION_RANKING_PREPARE')await new Promise(resolve=>setTimeout(resolve,state.delay));const result=await dispatch(job);state.completed++;return result;});
  const invalidate=createShopCacheInvalidation({redis,warm:schedule});
  const publishedRows=new Map();
  const createCardSession=async(request,entry,prepared)=>{const service=mocks['../services/collectionRankingSession.server.js'];return service.saveCollectionRankingSession(shop,marketAvailability.marketRankingFingerprint(service.collectionRankingFingerprint(request.url),entry.marketAvailabilityVersion),prepared.ids,entry.sessionUpdatedAt,prepared.metadata,entry.membershipProof);};
  const published=createPublishedCollectionPages({redis,createSession:createCardSession,readGlobalSettings:async()=>({prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true,showProductCount:true,...(state.wishlist?{integrations:{wishlist:true}}:{}),...(state.globalSettings||{})}),
    readConfigurationRevision:async()=>await redis.get(preparationRevisionKey(shop))||'0',
    saveDurable:async row=>{const old=publishedRows.get(row.key);if(old&&old.validatedAt>row.validatedAt)return false;publishedRows.set(row.key,row);return true;},
    loadDurable:async({shop:tenant,key})=>[...publishedRows.values()].find(row=>row.shop===tenant&&row.aliases.includes(key))?.payload});
  const cardStore=createCollectionCardStore({redis,publishedPages:{get:(request,options)=>state.publishedPages?published.get(request,options):null,publish:options=>state.publishedPages?published.publish(options):true},makeMembershipProof:async()=>state.membershipProof||'a'.repeat(64),
    readState:async({preparedKey})=>{const raw=await redis.get(preparedKey);let saved;try{saved=decodePreparation(raw);}catch{}return {configuration:await redis.get(preparationRevisionKey(shop))||'0',products:await redis.get(productRevisionKey(shop,'1'))||'0',globalProducts:await redis.get(productRevisionKey(shop,'all'))||'0',externalProducts:saved?.externalDependencies?await dependencies.revision(shop,saved.externalDependencies):undefined,hardAll:await redis.get('collectionRankingDataRevision:'+shop+':all')||'0',hardCollection:await redis.get('collectionRankingDataRevision:'+shop+':1')||'0',orderRevision:'native-order-v'+(state.orderVersion||0),preparedRaw:raw};},
    validateCards:(entry,prepared,options)=>validateCollectionCardDocuments(index,entry,prepared,{...options,preview:false}),
    createSession:async(request,entry,prepared)=>{const service=mocks['../services/collectionRankingSession.server.js'];return service.saveCollectionRankingSession(shop,service.collectionRankingFingerprint(request.url),prepared.ids,entry.sessionUpdatedAt,prepared.metadata);},
  });
  const responseCache=createCollectionResponseCache({readRevision:async()=>[
    String(await redis.get(preparationRevisionKey(shop))??'0'),String(await redis.get(productRevisionKey(shop,'all'))??'0'),
  ]});
  const mocks={
    '../utils/savedMarketPricing.js':savedMarketPricing,
    '../utils/collectionPriceCandidates.js':collectionPriceCandidates,
    'node:crypto':{createHash},
    '../services/searchRanking.server.js':{},
    'react-router':{data:(value,init)=>Response.json(value,init)},'../db.server':{__esModule:true,default:prisma},
    '../services/merchandising.server':{...merch,getActivePinningRuleForSearch:async()=>null,getActiveRuleForSearch:async()=>null,
      getActivePinningRuleForCollection:async()=>state.noPins?null:({products:(state.pinList||[state.pin]).map(id=>({id:'gid://shopify/Product/'+id}))}),
      getActiveRuleForCollection:async()=>state.noMerchandising?null:({conditions:[state.colorRule?{field:'Color',action:'Boost',value:'Blue'}:{field:'Tags',action:'Boost',value:'product-'+state.boost,operator:'contains'}]})},
    '../services/filterSettings.server':{},'../services/meiliClient.server':{__esModule:true,default:{index:()=>index}},
    '../services/shopCache.server':{getCached:async(key,fn)=>key.startsWith('globalSettings:')?{prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true,showProductCount:true,...(state.wishlist?{integrations:{wishlist:true}}:{}),...(state.globalSettings||{})}:key.startsWith('mergedValues:')?[]:key.startsWith('filterGroup:')?{resolvedCollectionId:key.endsWith(':search')?null:'gid://shopify/Collection/1',resolvedCollectionTitle:key.endsWith(':search')?'':'Fixture collection',activeGroupFilters:state.filterSettings||[]}:fn()},
    '../shopify.server':{},'../services/rateLimiter.server':{rateLimit:async()=>true},
    '../services/collectionBestSelling.server.js':{getCollectionBestSellingState:async()=>state.orderMissing?{ids:null,revision:null,status:'pending'}:({ids:state.orderVersion?docs.map(p=>p.id):docs.map(p=>p.id).reverse(),revision:'native-order-v'+(state.orderVersion||0),status:'ready',updatedAt:1+(state.orderVersion||0)})},
      '../utils/collectionPage.js':{fetchCollectionPage},'../utils/rankedCollectionPage.js':ranked,'../utils/collectionCards.js':collectionCards,'../utils/collectionPinnedPrefix.js':pinnedPrefix,
    '../services/collectionRankingSession.server.js':{collectionRankingFingerprint:url=>{const u=new URL(url);u.searchParams.delete('page');u.searchParams.delete('rankingToken');u.searchParams.delete('responseProfile');u.searchParams.delete('membershipParentToken');u.searchParams.delete('membershipParentQuery');u.searchParams.sort();return u.search;},
      getCollectionRankingSession:async(_shop,fingerprint,token)=>{if(!token)return null;const value=sessions.get(token);if(!value||value.fingerprint!==fingerprint)throw Error('Collection ranking session expired');return value;},
      saveCollectionRankingSession:async(_shop,fingerprint,ids,updatedAt,metadata,membershipProof)=>{const identity=JSON.stringify({fingerprint,ids,updatedAt,metadata,membershipProof});for(const value of sessions.values())if(JSON.stringify({fingerprint:value.fingerprint,ids:value.ids,updatedAt:value.updatedAt,metadata:value.metadata,membershipProof:value.membershipProof})===identity)return value;const hash=createHash('sha256').update(identity).digest('hex');const token=state.publishedPages?hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32):'fixture-token-'+sessions.size;const value={token,fingerprint,ids,updatedAt,metadata,membershipProof};sessions.set(token,value);return value;}},
    '../utils/collectionFilterMembership.js':collectionFilterMembership,
    '../services/collectionFilterMembership.server.js':{collectionMembershipProof:async()=>state.membershipProof||'a'.repeat(64)},
    '../services/collectionPreparation.server.js':{getCollectionPreparationRevision:preparation.revision,getPreparedCollectionRanking:(spec,options)=>{lastSpec=spec;if(state.rankingFailure==='throw')throw Error('Queue unavailable');if(state.rankingFailure==='failed')return {status:'failed'};return preparation.get(spec,options);},discardPreparedCollectionRanking:preparation.discard,registerCollectionWarmup:async()=>{},getCollectionHeadVersion:headVersion,reportCollectionHead:(spec,path,reason)=>headEvents.push({event:'head-'+path,reason,collectionId:spec.collectionId}),rememberCollectionHead:headProofs.remember,compareCollectionHead:headProofs.compare},
      '../services/collectionCards.server.js':{getPreparedCollectionCards:(request,options)=>state.cardSnapshots?cardStore.get(request,options):null,beginPreparedCollectionCards:options=>state.cardSnapshots?cardStore.begin({...options,preparedKey:options.preparedKey||(options.spec?preparationKey(options.spec):undefined)}):null},
    '../services/semanticSearch.server':{semanticMultiSearch:async queries=>{if(state.facetDelay||state.searchFacetDelay&&queries.some(query=>query.facets?.length))await new Promise(r=>setTimeout(r,state.facetDelay||state.searchFacetDelay));if(state.facetFailure)throw Error('Facet unavailable');facetRequests.push(...queries);trace.facetQueries+=queries.length;return {results:queries.map(select)};},searchPageBatch:async queries=>({results:queries.map(select)})},
    '../utils/searchColor.js':searchColor,'../utils/availableVariants.js':{...availableVariants,
      ...(savedPricePage?{savedVariantPricePage:(_database,args)=>savedPricePage(args,docs)}:{}),
      availableOptionFacetCounts:async(_database,{productIds,optionValues,mergedValues})=>{
      const selected=new Set(productIds.map(id=>String(id).split('/').pop())),counts={};
      for(const [name,rawValues]of Object.entries(optionValues)){
        counts[name]={};
        for(const product of docs.filter(doc=>selected.has(doc.id))){
          const position=product.options.findIndex(option=>option.name.toLowerCase()===name.toLowerCase());
          if(position<0)continue;
          const values=new Set((product.variantPrices||[]).filter(variant=>variant.available===true)
            .map(variant=>variant[`option${position+1}`]).filter(value=>rawValues.some(raw=>raw.trim().toLowerCase()===String(value||'').trim().toLowerCase()))
            .map(value=>facetNormalization.mappedFacetValue(name,value,mergedValues)));
          for(const value of values)counts[name][value]=(counts[name][value]||0)+1;
        }
      }
      return counts;
    }},'../utils/spellingCorrection.js':{spellingCorrection},
    '../utils/collectionBootstrap.js':collectionBootstrap,'../utils/collectionResponse.js':collectionResponse,
    '../utils/productTitleFilter.js':productTitleFilter,
    '../utils/extraProductFilters.js':extraProductFilters,
    '../utils/percentSaleFilter.js':percentSaleFilter,
    '../utils/collectionNavigation.js':collectionNavigation,
    '../utils/marketAvailability.js':marketAvailability,
    '../utils/facetNormalization.js':facetNormalization,
    '../utils/searchCachePolicy.js':searchCachePolicy,
    '../services/searchIndex.server.js':{getSearchIndexContext:async()=>({uid:'products',settings:null,custom:false})},
    '../utils/searchConfiguration.js':{publicSearchProduct:product=>product},
    '../services/marketAvailability.server.js':{getMarketAvailabilityState:async(_shop,country)=>state.countryStock?{status:'ready',version:country+':'+state.countryStock.version}:{status:'disabled',version:null},getMarketAvailableProductIds:async(_shop,country)=>state.countryStock.ids[country]},
    '../services/marketPriceCoverage.server.js':{marketPriceIntentReady:async()=>state.marketPriceReady===true,marketPriceScopeReady:async()=>state.marketPriceScopeReady??state.marketPriceReady===true,collectionPriceBoundReady:async()=>state.nativePriceBoundReady===true},
    '../utils/searchPinnedIntent.js':{pinnedProductMatchesAppliedIntent:()=>true},
  };
  mocks['../utils/filterPresentation.js']=filterPresentation;
  const readCached=mocks['../services/shopCache.server'].getCached;
  mocks['../services/shopCache.server'].getCached=(key,fetchValue,...args)=>{
    if(!key.includes(':sorted-price-v2:'))return readCached(key,fetchValue,...args);
    if(!savedPriceReads.has(key))savedPriceReads.set(key,Promise.resolve().then(fetchValue).catch(error=>{savedPriceReads.delete(key);throw error;}));
    return savedPriceReads.get(key);
  };
  const routeCtx={module:{exports:{}},exports:{},URL,Response,responseCache,fixtureBootstrap:collectionBootstrap,fixtureResponse:collectionResponse,fixtureCollectionPageFingerprint:collectionPageFingerprint,console:{log(){},error(){}},require:name=>{if(!(name in mocks))throw Error('Unexpected fixture import '+name);return mocks[name];}};
  const source=(await fs.readFile('app/routes/api.filter.jsx','utf8')).replace('await import("../services/queryParser.server.js")','({parseQuery:()=>null})').replace("await import('../services/collectionResponse.server.js')",'({beginCollectionResponse:responseCache.begin,collectionPageFingerprint:fixtureCollectionPageFingerprint})').replace("await import('../utils/collectionBootstrap.js')",'fixtureBootstrap').replace("await import('../utils/collectionResponse.js')",'fixtureResponse');
  vm.runInNewContext((await transform(source,{loader:'jsx',format:'cjs'})).code,routeCtx);
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/collectionFilterPro.css"><style>body{margin:0;font:16px Arial}header{position:sticky;top:0;z-index:4;background:#fff;height:80px;border-bottom:1px solid}#mega-menu{position:absolute;top:80px;left:0;right:0;height:240px;background:#eee;display:none}#mega-menu.open{display:block}.cfp-v1-app-container{padding:16px;min-height:1600px}.cfp-main-content{width:100%}</style><script>window.Shopify={locale:'en',country:'US',currency:{active:'USD',rate:1},routes:{root:'/'}};window.collectionFilterProSettings={columns_desktop:4,columns_mobile:2};window.browserErrors=[];addEventListener('error',e=>browserErrors.push(e.message));addEventListener('unhandledrejection',e=>browserErrors.push(String(e.reason)));window.cardSnapshots=[];new MutationObserver(()=>{const cards=[...document.querySelectorAll('.cfp-product-card--reveal')];if(cards.length&&!window.inserted){window.inserted=true;cardSnapshots.push({at:performance.now(),cards:cards.length,imagesLoaded:cards.filter(c=>c.querySelector('img').complete&&c.querySelector('img').naturalWidth>0).length,pricesReady:cards.filter(c=>!c.innerText.includes('See product price')).length,delays:cards.slice(0,6).map(c=>getComputedStyle(c).animationDelay)})}}).observe(document.documentElement,{childList:true,subtree:true});</script></head><body><header><button id="menu-open" onclick="document.getElementById('mega-menu').classList.toggle('open')">Open mega menu</button><div id="mega-menu">Header mega menu</div></header><div class="cfp-v1-app-container"><div class="cfp-layout-wrapper"><div id="cfp-top-bar" class="cfp-top-bar"><div class="cfp-top-bar__left"><button id="cfp-drawer-trigger-btn">Filters</button><span class="cfp-product-count"></span></div><div class="cfp-top-bar__right"><div class="cfp-custom-sort"><div class="cfp-custom-sort__trigger" id="cfp-custom-sort-trigger"><span id="cfp-custom-sort-label">Best selling</span></div><div class="cfp-custom-sort__dropdown" id="cfp-custom-sort-dropdown"><div class="cfp-custom-sort__option" data-value="best-selling">Best selling</div><div class="cfp-custom-sort__option" data-value="price-ascending">Price low to high</div></div></div></div></div><aside id="cfp-sidebar" class="cfp-sidebar" data-shop="${shop}" data-collection-id="1" data-collection-handle="fixture" data-template-name="collection"><div class="cfp-sidebar__header"><button id="cfp-close-btn">Close</button></div><div class="cfp-sidebar__body"><div id="cfp-breadcrumbs"></div><div id="cfp-sidebar__filter-groups"></div></div><div class="cfp-sidebar__footer"><button id="cfp-apply-btn">Apply</button><button id="cfp-clear-btn">Clear</button></div></aside><main class="cfp-main-content"><div id="cfp-products-container" class="cfp-products-grid"></div></main></div></div><div id="cfp-overlay" class="cfp-overlay"></div><script src="/assets/marketPricing.js"></script><script src="/assets/collectionFilterPro.js"></script><script>API_DOMAIN=location.origin;</script></body></html>`;
  const liquid=await fs.readFile('extensions/theme-extension/snippets/collectionFilterPro.liquid','utf8');
  const footerHtml=liquid.match(/<div class="cfp-sidebar__footer">[\s\S]*?<\/div>/)[0];
  const toolbarStart=liquid.indexOf('<div id="cfp-top-bar"');
  const toolbarScriptStart=liquid.indexOf('<script>',toolbarStart);
  const toolbarHtml=liquid.slice(toolbarStart,toolbarScriptStart)
    .replace("{% if template.name == 'search' %}Relevance{% else %}Best selling{% endif %}",'Best selling')
    .replace(/{% if template.name == 'search' %}[\s\S]*?{% endif %}/g,'');
  const toolbarScript=liquid.slice(toolbarScriptStart,liquid.indexOf('</script>',toolbarScriptStart)+9);
  const loadingBlock=await fs.readFile('extensions/theme-extension/blocks/collection_loading.liquid','utf8');
  const inlineFilters=(await fs.readFile('extensions/theme-extension/snippets/collection_filters_start.liquid','utf8')).replaceAll('https://aisearchfilter.webvory.com','http://127.0.0.1:PORT');
  const observedHtml=html.replace("pricesReady:cards.filter(c=>!c.innerText.includes('See product price')).length", "pricesReady:cards.filter(c=>c.querySelector('.cfp-product-card__price')&&!c.innerText.includes('See product price')).length").replaceAll('/assets/collectionFilterPro.js','/assets/collectionWidget.js');
  // Exercise the published block's actual async entry points, so this fixture
  // cannot pass with an async renderer that the extension never loads.
  const headAsyncScripts=[...loadingBlock.matchAll(/<script src="\{\{ '([^']+)' \| asset_url \}\}"[^>]*async="async"><\/script>/g)]
    .map(match=>`<script async fetchpriority="${match[0].includes('fetchpriority="high"')?'high':'auto'}" src="/assets/${match[1]}"></script>`).join('');
  const start=liquid.indexOf('  (function() {',liquid.indexOf('Fire API request'));
  const inline=liquid.slice(start,liquid.indexOf('</script>',start)).replace('{{ shop.permanent_domain }}',shop).replace('{{ cfp_collection_handle }}','fixture').replace('{{ cfp_collection_id }}','1').replaceAll('{{ request.locale.iso_code }}','en').replaceAll("'https://aisearchfilter.webvory.com", "location.origin + '");
  const sockets=new Set();
  let adminControlsBundle;
  let barColorBundle;
  let filterWidthBundle;
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    try{
      if(url.pathname==='/filter-width-admin'){
        res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:14px Arial;margin:16px}.settings-row{display:flex;justify-content:space-between;margin-bottom:16px}.settings-text-col{flex:1;min-width:180px}</style></head><body><div id="root"></div><script>window.savedWidths=[];window.browserErrors=[];addEventListener("error",e=>browserErrors.push(e.message));addEventListener("unhandledrejection",e=>browserErrors.push(String(e.reason)))</script><script src="/filter-width-admin.js"></script></body></html>');return;
      }
      if(url.pathname==='/filter-width-admin.js'){
        if(!filterWidthBundle){
          const source=await fs.readFile('app/routes/app.filters.settings.jsx','utf8');
          const component=source.slice(source.indexOf('function SettingFilterWidth('),source.indexOf('function SettingBarColor('));
          filterWidthBundle=build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{FILTER_WIDTH_LIMITS,isValidFilterWidth}from'./app/utils/filterWidths.js';${component}\nfunction App(){const[drawer,setDrawer]=useState(Number(localStorage.getItem('drawerWidth')||420));const[vertical,setVertical]=useState(Number(localStorage.getItem('verticalFilterWidth')||420));const save=(key,set,next)=>{window.savedWidths.push({key,value:next});localStorage.setItem(key,String(next));set(next)};return <><SettingFilterWidth label="Drawer width" description="Drawer filters" value={drawer} onChange={v=>save('drawerWidth',setDrawer,v)}/><SettingFilterWidth label="Vertical sidebar width" description="Vertical filters" value={vertical} onChange={v=>save('verticalFilterWidth',setVertical,v)}/></>};createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}}).then(result=>result.outputFiles[0].text);
        }
        res.setHeader('Content-Type','text/javascript');res.end(await filterWidthBundle);return;
      }
      if(url.pathname==='/bar-color-admin'){
        res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><style>body{font:14px Arial;margin:24px}.settings-row{display:flex;gap:24px}.settings-text-col{flex:1}</style></head><body><div id="root"></div><script>window.savedColors=[]</script><script src="/bar-color-admin.js"></script></body></html>');return;
      }
      if(url.pathname==='/bar-color-admin.js'){
        if(!barColorBundle){
          const source=await fs.readFile('app/routes/app.filters.settings.jsx','utf8');
          const component=source.slice(source.indexOf('function SettingBarColor('),source.indexOf('function SettingsSection('));
          barColorBundle=build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';${component}\nfunction App(){const[value,setValue]=useState('');return <SettingBarColor value={value} onChange={next=>{window.savedColors.push(next);setValue(next)}} disabled={false}/>};createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}}).then(result=>result.outputFiles[0].text);
        }
        res.setHeader('Content-Type','text/javascript');res.end(await barColorBundle);return;
      }
      if(url.pathname==='/filter-controls-admin'){
        res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><div id="root"></div><script>window.browserErrors=[];addEventListener("error",e=>browserErrors.push(e.message));addEventListener("unhandledrejection",e=>browserErrors.push(String(e.reason)))</script><script src="/filter-controls-admin.js"></script></body></html>');return;
      }
      if(url.pathname==='/filter-controls-admin.js'){
        adminControlsBundle??=build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{CreateFilterModal}from'./app/components/ui/CreateFilterModal.jsx';
          function App(){const [open,setOpen]=useState(true);const [saved,setSaved]=useState({id:'price',optionType:'price',filterTitle:'Price',displayMode:'List',priceRanges:[{label:'{0} - {1}',min:0,max:0},{label:'From {0}',from:10,to:''}],advanced:{desktopSearchBox:false,mobileSearchBox:false}});return <><button id="reopen" onClick={()=>setOpen(true)}>Reopen saved filter</button><CreateFilterModal isOpen={open} onClose={()=>setOpen(false)} initialData={saved} storeData={{priceFilterDisplayMode:'List'}} onSave={data=>{window.lastSaved=data;setSaved({...data,id:'price'});setOpen(false)}}/></>};createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}}).then(result=>result.outputFiles[0].text);
        res.setHeader('Content-Type','text/javascript');res.end(await adminControlsBundle);return;
      }
      if(url.pathname==='/__control'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);const updates=JSON.parse(Buffer.concat(chunks).toString()||'{}');
        if(updates.reset||updates.invalidate)savedPriceReads.clear();
        if(updates.reset){state.country=null;state.realToolbar=false;state.independentFilters=false;state.savedFilterDelay=0;state.savedFilterFailures=0;state.savedFilterAttempts=0;state.themeIntro=false;state.noMatchQuery=null;}
        if(updates.reset){for(const socket of sockets)if(socket!==req.socket)socket.destroy();for(const timer of timers)clearTimeout(timer);timers.clear();if(redisLayer)await redisLayer.reset();values.clear();sessions.clear();jobs.clear();responseCache.clear();requests.length=0;requestStarts.length=0;docs.forEach(doc=>doc.status='ACTIVE');delete state.stormTimer;Object.assign(state,{delay:100,priceDelay:50,imageDelay:50,pin:'1',boost:'2',fail:false,hold:false,builds:0,completed:0,revision:0,apiFailure:null,directFacts:false,facetDelay:0,searchFacetDelay:0,facetFailure:false,cardSnapshots:false,noPins:false,headRenderer:false,themeDelay:0,htmlDelay:0,wishlist:false});}
        if(updates.reset){state.streamDelay=0;state.pinList=null;state.orderMissing=false;state.rankingFailure=null;state.publishedPages=false;publishedRows.clear();headEvents.length=0;}
        if(updates.reset){state.desktopColumns=4;state.mobileColumns=2;state.filterSettings=null;state.noMerchandising=false;state.countryStock=null;state.marketPriceReady=false;state.nativeVariants=null;}
        if(updates.productCount){docs.splice(0,docs.length,...Array.from({length:updates.productCount},makeDoc));byId.clear();docs.forEach(doc=>byId.set(doc.id,doc));}
        if(updates.productFields)for(const [id,fields]of Object.entries(updates.productFields))Object.assign(byId.get(id),fields);
        if(updates.productVariants)for(const [id,variants]of Object.entries(updates.productVariants)){
          const doc=byId.get(id);doc.variantPrices=variants;doc.options=[{name:'Color',values:[...new Set(variants.map(v=>v.option1))]}];
        }
        for(const [key,value]of Object.entries(updates))if(!['reset','invalidate','stormCollection','stopStorm','corruptPrepared','expireTokens','archive','deleteProduct'].includes(key))state[key]=value;
        if(redisLayer){if(state.hold)await redisLayer.worker.pause();else redisLayer.worker.resume();}
        if(updates.invalidate){state.revision++;await invalidate(shop);}
        if(updates.unrelatedExternalUpdate)await invalidate(shop,{kind:'products',collectionIds:[],externalProof:{tags:['Unrelated'],ids:['999']}});
        if(updates.corruptPrepared){await preparation.discard(lastSpec);await redis.set((await import('../../app/utils/collectionPreparation.js')).preparationKey(lastSpec),'{corrupt');}
        if(updates.expireTokens)sessions.clear();
        if(updates.archive)byId.get(updates.archive).status='ARCHIVED';
        if(updates.deleteProduct)byId.get(updates.deleteProduct).status='DELETED';
        if(updates.stormCollection){const timer=setInterval(()=>invalidate(shop,{kind:'products',collectionIds:[updates.stormCollection]}).catch(()=>{}),150);timers.add(timer);state.stormTimer=timer;}
        if(updates.stopStorm&&state.stormTimer){clearInterval(state.stormTimer);timers.delete(state.stormTimer);delete state.stormTimer;}
        if(updates.precompute)await warm(shop,null,true);
        if(updates.publishFirst50){
          const response=await routeCtx.module.exports.loader({request:new Request('http://fixture/api/filter?locale=en&shop='+shop+'&country='+(updates.publishCountry||'US')+'&collectionHandle=fixture&sortBy=best-selling&page=1&limit=50&responseProfile=collection-cards-v1'),params:{},context:{rankingWarmup:true,rankingCardsPrecompute:true,rankingPrecompute:true}});
          if(response.status!==200||response.headers.get('X-CFP-Collection-Cards')!=='stored')throw Error('Published fixture preparation failed: '+response.status+' '+response.headers.get('X-CFP-Collection-Cards'));
        }
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:{...state,stormTimer:!!state.stormTimer},requests}));return;
      }
      if(url.pathname==='/__state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({state:{...state,stormTimer:!!state.stormTimer},trace,headEvents,requests,configurationRequests,requestStarts,queueFailures:redisLayer?.failures||[],productRevision:await redis.get(productRevisionKey(shop,'1'))||'0'}));return;}
      if(url.pathname==='/slow-theme.js'){
        await new Promise(resolve=>setTimeout(resolve,state.themeDelay||0));res.setHeader('Content-Type','text/javascript');res.end("document.addEventListener('DOMContentLoaded',()=>{window.pageDataMap={};});");return;
      }
      if(url.pathname.startsWith('/assets/')){
        const name=url.pathname.split('/').pop();if(!['collectionFilters.js','collectionWidget.js','collectionFilterPro.min.js','collectionFilterPro.css','marketPricing.js','collectionLoading.min.js','collectionPreviewStream.min.js'].includes(name)){res.writeHead(404).end();return;}
        if(name==='collectionFilterPro.css'&&state.cssDelay)await new Promise(resolve=>setTimeout(resolve,state.cssDelay));
        if(name==='collectionFilterPro.min.js'&&state.assetDelay)await new Promise(resolve=>setTimeout(resolve,state.assetDelay));
        if(name==='collectionLoading.min.js'&&state.headDelay)await new Promise(resolve=>setTimeout(resolve,state.headDelay));
        res.setHeader('Content-Type',name.endsWith('css')?'text/css':'text/javascript');let asset=await fs.readFile('extensions/theme-extension/assets/'+name,'utf8');asset=asset.replaceAll('https://aisearchfilter.webvory.com','http://127.0.0.1:'+server.address().port);res.end(asset);return;
      }
      if(url.pathname==='/api/collection-filters'){
        state.savedFilterAttempts=(state.savedFilterAttempts||0)+1;
        if(state.savedFilterFailures>0){state.savedFilterFailures--;res.writeHead(202,{'Content-Type':'application/json'}).end(JSON.stringify({cfpFilters:{version:1,status:'pending'}}));return;}
        if(state.savedFilterDelay)await new Promise(resolve=>setTimeout(resolve,state.savedFilterDelay));
        const canonical=new URL(url);canonical.pathname='/api/filter';canonical.searchParams.set('responseProfile','collection-v1');
        const saved=await published.get(new Request(canonical),{filtersOnly:true});
        const response=saved||Response.json({cfpFilters:{version:1,status:'pending'}},{status:202});
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
      }
      if(url.pathname==='/api/filter'){
        if(url.searchParams.get('responseProfile')!=='collection-config-v1')requestStarts.push({sort:url.searchParams.get('sortBy'),startedAt:Date.now()});
        if(state.apiDelay)await new Promise(resolve=>setTimeout(resolve,state.apiDelay));
        if(res.destroyed)return;
        if(state.apiFailure==='once'&&url.searchParams.get('responseProfile')!=='collection-config-v1'){
          state.apiFailure=null;
          res.writeHead(502,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Temporary upstream failure'}));
          return;
        }
        if(state.apiFailure==='html'){res.writeHead(502,{'Content-Type':'text/html'}).end('<html>Proxy unavailable</html>');return;}
        if(state.apiFailure==='empty'){res.writeHead(200,{'Content-Type':'application/json'}).end('{}');return;}
        const response=await routeCtx.module.exports.loader({request:new Request('http://fixture'+req.url,{headers:req.headers}),params:{},context:{}});
        const streaming=response.headers.get('Content-Type')?.includes('application/x-ndjson');
        const captured=[];let chunkIndex=0;res.writeHead(response.status,Object.fromEntries(response.headers));
        for await(const chunk of response.body){if(streaming&&chunkIndex++>1&&state.streamDelay)await new Promise(resolve=>setTimeout(resolve,state.streamDelay));captured.push(Buffer.from(chunk));if(!res.destroyed)res.write(Buffer.from(chunk));}res.end();
        const bytes=Buffer.concat(captured);
        const text=(response.headers.get('Content-Encoding')==='gzip'?gunzipSync(bytes):bytes).toString();
        let data;
        if(streaming){const records=text.trim().split('\n').map(line=>JSON.parse(line));data={...records[0].payload,products:records.filter(r=>r.type==='product').map(r=>r.product)};}else data=text?JSON.parse(text):{};
        const target=url.searchParams.get('responseProfile')==='collection-config-v1'?configurationRequests:requests;
        target.push({profile:url.searchParams.get('responseProfile'),page:url.searchParams.get('page'),sort:url.searchParams.get('sortBy'),query:url.searchParams.get('q'),token:url.searchParams.get('rankingToken'),membershipParent:!!url.searchParams.get('membershipParentToken'),status:response.status,source:response.headers.get('X-CFP-Collection-Cards'),products:data.products?.length,first:data.products?.[0]?.id,ranking:data.debug?.collectionRankingStatus,revision:state.revision});
        return;
      }
      if(url.pathname==='/collections.json'){
        res.setHeader('Content-Type','application/json');
        res.end(JSON.stringify({collections:[{handle:'formal-dresses',title:'Formal Dresses'},{handle:'prom-dresses',title:'Prom Dresses'}]}));return;
      }
      if(url.pathname.startsWith('/products/')){
        const id=url.pathname.match(/dress-(\d+)/)?.[1];const doc=byId.get(id);await new Promise(resolve=>setTimeout(resolve,state.priceDelay));
        const nativeVariants=state.nativeVariants?.[id]||doc.variantPrices;
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({price_min:doc.priceMin*100,price_max:doc.priceMax*100,variants:nativeVariants.map(v=>({id:Number(v.id),price:(v.price??doc.priceMin)*100,compare_at_price:v.compareAtPrice==null?null:v.compareAtPrice*100,available:v.available===true}))}));return;
      }
      if(url.pathname.startsWith('/image/')){
        await new Promise(resolve=>setTimeout(resolve,state.imageDelay));res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480"><rect width="360" height="480" fill="#b9cdee"/></svg>');return;
      }
      if(url.pathname.startsWith('/collections/')||url.pathname==='/search'){if(state.htmlDelay)await new Promise(r=>setTimeout(r,state.htmlDelay));res.setHeader('Content-Type','text/html');let body=observedHtml.replace('<style>body','<style>*,*::before,*::after{box-sizing:border-box}body')
        .replace('class="cfp-v1-app-container"',`class="cfp-v1-app-container" style="--cfp-cols-desktop:${state.desktopColumns??4};--cfp-cols-mobile:${state.mobileColumns??2}"`)
        .replace('columns_desktop:4,columns_mobile:2',`columns_desktop:${state.desktopColumns??4},columns_mobile:${state.mobileColumns??2}`);
        if(state.themeIntro)body=body.replace('<main class="cfp-main-content">','<div class="cfp-main-content">').replace('</main>','</div>')
          .replace('<div class="cfp-v1-app-container"','<main id="fixture-main"><section class="shopify-section" id="fixture-intro" style="height:300px;background:#fafafa"><h1>Fixture collection</h1><p>Native collection title and category tiles</p></section><section class="shopify-section" id="fixture-app-section"><div class="cfp-v1-app-container"')
          .replace('</body>','</section><section class="shopify-section" id="fixture-faq"><h2>Collection details</h2></section><footer id="fixture-footer">Footer</footer></main></body>');
        if(state.independentFilters)body=body.replace('</head>','<script src="/assets/collectionFilters.js"></script></head>');
        if(url.pathname==='/search')body=body.replace('data-collection-id="1" data-collection-handle="fixture" data-template-name="collection"','data-collection-id="" data-collection-handle="" data-template-name="search" data-search-terms="purple prom dress"');
        if(url.pathname==='/search')body=body.replace('data-search-terms="purple prom dress"','data-search-terms="'+String(url.searchParams.get('q')||'')+'"');
        body=body.replace('<script>window.Shopify=',`<script>window.cfpPriceSortVersion=${state.variantPriceSort?2:1};window.Shopify=`);
        if(state.countryStock||state.country)body=body.replace("country:'US'",'country:'+JSON.stringify(url.searchParams.get('country')||state.country||'US'));
        if(state.country==='IN')body=body.replace("active:'USD',rate:1","active:'INR',rate:1");
        body=body.replace(/<div class="cfp-sidebar__footer">[\s\S]*?<\/div>/,footerHtml);
        if(state.realToolbar)body=body.replace(/<div id="cfp-top-bar" class="cfp-top-bar">[\s\S]*?(?=<aside id="cfp-sidebar")/,toolbarHtml).replace('</body>',toolbarScript+'</body>');
        if(state.headRenderer){
        body=body.replace('<link rel="stylesheet"','<meta name="cfp-collection-context" data-shop="'+shop+'" data-handle="fixture" data-country="US" data-locale="en" data-customer-logged-in="false" data-customer-tags="">'+headAsyncScripts+'<script defer src="/slow-theme.js"></script><link rel="stylesheet"')
          .replace(headAsyncScripts,inlineFilters.replaceAll('127.0.0.1:PORT','127.0.0.1:'+server.address().port)+headAsyncScripts)
          .replace('<script src="/assets/marketPricing.js">','<span id="cfp-collection-ready" hidden></span><script defer src="/assets/marketPricing.js">')
          .replace('<script src="/assets/collectionWidget.js">','<script defer src="/assets/collectionWidget.js">');
        }if(state.early){const scopedInline=url.pathname==='/search'?inline.replace('var collHandle = "fixture"','var collHandle = ""').replace('var collId = "1"','var collId = ""'):inline;const earlyScript='<script>window.Shopify=window.Shopify||{locale:"en",country:"US"};'+scopedInline+'</script>';body=state.earlyBeforeStyles?body.replace('<link rel="stylesheet"',earlyScript+'<link rel="stylesheet"'):body.replace('<script src="/assets/marketPricing.js">',earlyScript+'<script src="/assets/marketPricing.js">');}res.end(body);return;}
      res.writeHead(404).end();
    }catch(error){if(res.headersSent){res.destroy();return;}res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));}
  });
  // Timing cases navigate away before reset. Close only this fixture's old
  // sockets so intentionally delayed images cannot occupy the next case's pool.
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  return {server,state,trace,facetRequests,documents:docs,sessionCount:()=>sessions.size,latestRankingToken:()=>[...sessions.keys()].at(-1)||null,load:(request,context={})=>routeCtx.module.exports.loader({request,context,params:{}}),
    prepareLast:()=>preparation.process({key:preparationKey(lastSpec),spec:lastSpec}),
    dispose(){for(const timer of timers)clearTimeout(timer);timers.clear();server.closeAllConnections();server.close();}};
}
