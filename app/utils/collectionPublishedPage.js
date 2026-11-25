import {hasUsableExtraFacets} from './extraProductFilters.js';
import {productRefreshIntervalMs} from './collectionPreparation.js';
import {hasUsableSaleFacets} from './percentSaleFilter.js';
import {createHash} from 'node:crypto';
import {encodePreparation,decodePreparation} from './collectionPreparationPayload.js';
import {hasUsableProductTitleFacets} from './productTitleFilter.js';
import {hasUsableCollectionNavigation} from './collectionNavigation.js';
import {isPublicCollectionCards,collectionCardsResponse,acceptsPublishedCollectionPage,collectionCardPresentationVersion} from './collectionCards.js';
import {visibleCollectionFacets} from './collectionBootstrap.js';
import {hasCurrentCollectionFacetScope} from './collectionFacetScope.js';

export function publishedCollectionKey(request){
 const url=new URL(request.url),page=url.searchParams.get('page');
 const keys=[...url.searchParams.keys()];
 if(new Set(keys).size!==keys.length||!['collection-cards-v1','collection-preview-v1','collection-v1','collection-v2'].includes(url.searchParams.get('responseProfile')))return null;
 if(!['1','2'].includes(page)||!['25','50'].includes(url.searchParams.get('limit')))return null;
 url.searchParams.delete('rankingToken');url.searchParams.set('page','1');url.searchParams.set('limit','25');url.searchParams.set('responseProfile','collection-cards-v1');
 if(!isPublicCollectionCards(new Request(url,{method:request.method})))return null;
 url.searchParams.sort();
 return `collectionPublishedPage:${url.searchParams.get('shop')}:${createHash('sha256').update(url.pathname+'?'+url.searchParams).digest('hex')}`;
}
// Published versions are deliberately independent of working ranking epochs.
// Only a complete, verified replacement is published; visits never rebuild it.
export function createPublishedCollectionPages({redis,loadDurable,saveDurable,createSession,readGlobalSettings,readConfigurationRevision,readCatalogInvalidatedAt,readMarketRuleInvalidatedAt,readExternalProof,now=Date.now,lifetime=86400}){
 const valid=(entry,serving=false)=>entry?.version===1&&entry.cardPresentationVersion===collectionCardPresentationVersion&&Number.isFinite(entry.at)&&entry.at<=now()&&(serving||now()-entry.at<lifetime*1000)&&
  Array.isArray(entry.ids)&&new Set(entry.ids).size===entry.ids.length&&entry.ids.every(id=>/^\d+$/.test(id))&&
  Number.isSafeInteger(entry.payload?.totalCount)&&entry.payload.totalCount===entry.ids.length&&
  Array.isArray(entry.payload.products)&&entry.payload.products.length===Math.min(50,entry.ids.length)&&
  entry.payload.products.every((p,i)=>String(p.id).split('/').pop()===entry.ids[i]&&p.title&&p.handle)&&
  entry.payload.settings&&entry.payload.facets&&hasUsableExtraFacets(entry.payload)&&hasUsableSaleFacets(entry.payload)&&hasUsableProductTitleFacets(entry.payload)&&hasUsableCollectionNavigation(entry.payload);
 async function get(request,{onHit,marketAvailabilityVersion=null,allowStaleMarket=false,probe=false,filtersOnly=false}={}){
  const key=publishedCollectionKey(request);if(!key||!probe&&!filtersOnly&&!acceptsPublishedCollectionPage(request))return null;
  const params=new URL(request.url).searchParams,shop=params.get('shop'),page=Number(params.get('page')),token=params.get('rankingToken');
  if(!probe&&params.get('limit')!=='25'||probe&&!['25','50'].includes(params.get('limit'))||page===2&&!/^[a-f0-9-]{36}$/.test(token||''))return null;
  try{
   let raw;try{raw=await redis.get(page===2?`collectionPublishedSession:${shop}:${token}`:key);}catch{}
   if(!raw&&loadDurable)raw=await loadDurable({shop,kind:'published',key});
   if(!raw||Buffer.byteLength(raw)>2*1024*1024)return null;
   const entry=decodePreparation(raw);if(entry.shop!==shop||!entry.aliases?.includes(key)||!valid(entry,true))return null;
   // Retire stock-restricted publications from the reverted release, as well
   // as publications with an obsolete pin or merchandising configuration.
   const catalogInvalidatedAt=readCatalogInvalidatedAt?Number(await readCatalogInvalidatedAt(shop,entry.collectionId)):0;
   const marketRuleInvalidatedAt=readMarketRuleInvalidatedAt?Number(await readMarketRuleInvalidatedAt(shop,params.get('country'))):0;
   const stockChanged=entry.marketAvailabilityRevision!=null||(entry.marketAvailabilityVersion??null)!==marketAvailabilityVersion;
   // A completed refresh with the same eligibility clears an earlier pending
   // window, so the next independent stock change gets its own short window.
   if(!stockChanged&&entry.marketAvailabilityVersion&&typeof redis.del==='function')
    Promise.resolve().then(()=>redis.del(key+':staleStockSince')).catch(()=>{});
   let stockStaleAllowed=false;
   if(stockChanged&&allowStaleMarket&&!probe&&entry.marketAvailabilityRevision==null&&entry.marketAvailabilityVersion&&typeof redis.set==='function'){
    const staleKey=key+':staleStockSince';
    await redis.set(staleKey,String(now()),'NX');
    const since=Number(await redis.get(staleKey));
    stockStaleAllowed=Number.isFinite(since)&&since>0&&now()-since<600000;
   }
   const configurationChanged=Boolean(readConfigurationRevision&&entry.configuration!==String(await readConfigurationRevision(shop)));
   let externalChanged=false;
   if(readExternalProof){
    if(typeof entry.external!=='boolean')externalChanged=true;
    else if(entry.external){const current=await readExternalProof(shop,entry.externalDependencies);
      externalChanged=!current||current!==entry.externalRevision;}
   }
   // Product/order changes rebuild at most once per interval (see productRefreshIntervalMs).
   const productRefreshAllowed=now()-entry.at>=productRefreshIntervalMs;
   const catalogChanged=(catalogInvalidatedAt>0&&catalogInvalidatedAt>=entry.at||externalChanged)&&productRefreshAllowed||marketRuleInvalidatedAt>0&&marketRuleInvalidatedAt>=entry.at;
   // A saved merchandising or pin change must take effect on the next visit.
   // Serving the old publication here hides the current admin order.
   const ruleChanged=configurationChanged||marketRuleInvalidatedAt>0&&marketRuleInvalidatedAt>=entry.at;
   // Product/catalog changes can keep the last complete page briefly while a
   // replacement is prepared; country stock follows its separate freshness limit.
   if(ruleChanged||stockChanged&&!stockStaleAllowed||entry.configuration==null&&readConfigurationRevision){
    if(page===2)return Response.json({error:'Collection settings changed. Restart this collection.'},{status:409,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
    if(onHit){const visit=new URL(request.url);visit.searchParams.delete('rankingToken');
     Promise.resolve().then(()=>onHit({request:new Request(visit),entry,published:true,refreshDue:true})).catch(()=>{});
    }
    return null;
   }
   const optionCountsChanged=entry.payload.globalSettings?.hideUnavailableVariantsWhenSelected===true&&entry.payload.facets?.variantCountVersion!==1;
   const legacyFacetScope=!hasCurrentCollectionFacetScope(entry.payload);
   const legacyMembershipProof=typeof entry.membershipProof==='string'&&!entry.membershipProof.startsWith('snapshot-v1:');
   const refreshDue=stockChanged||configurationChanged||catalogChanged||optionCountsChanged||legacyFacetScope||legacyMembershipProof||now()-entry.at>=lifetime*1000;
   if(probe&&refreshDue)return null;
   // Presentation preferences must be fresh even while the last complete
   // product publication is retained. Eligibility changes require a new order.
   let globalSettings=entry.payload.globalSettings;
   if(readGlobalSettings){
    const current=await readGlobalSettings(shop);if(!current)return null;
    const rankingFlags=['showOnlyInStock','prioritizeSortOverPinning','prioritizeSortOverMerchandising','hideUnavailableVariantsWhenSelected'];
    if(rankingFlags.some(key=>(current[key]===true)!==(globalSettings?.[key]===true))){
     if(page===2)return Response.json({error:'Collection settings changed. Restart this collection.'},{status:409,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
     return null;
    }
    globalSettings=current;
   }
   // Background coverage checks need the same proof as a shopper, without
   // creating a browsing session or rewriting the saved publication.
   if(probe)return new Response(null,{status:200,headers:{'X-CFP-Collection-Cards':'published'}});
   // Read already-computed collection-wide filters without creating a product
   // session, hydrating cards, scanning the index or waiting for ranking.
   if(filtersOnly&&legacyFacetScope)return null;
   if(filtersOnly){const text=JSON.stringify({settings:entry.payload.settings,mergedValues:entry.payload.mergedValues||[],globalSettings,
    facets:visibleCollectionFacets(entry.payload.facets,entry.payload.settings),totalCount:entry.payload.totalCount,
    cfpFilters:{version:1,publishedAt:entry.at,refreshDue}});
    const etag='"'+createHash('sha256').update(text).digest('hex')+'"';
    const match=request.headers.get('If-None-Match')?.split(',').some(value=>value.trim().replace(/^W\//,'')===etag);
    return new Response(match?null:text,{status:match?304:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-cache, must-revalidate','Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'ETag, X-CFP-Collection-Filters',ETag:etag,'X-CFP-Collection-Filters':'published'}});
   }
   const session=await createSession(request,entry,{ids:entry.ids,metadata:entry.metadata});
   if(page===2&&session.token!==token)return null;
   // One immutable copy per shared ranking token keeps page two on the same
   // published version even if a replacement is published between clicks.
   if(page===1)await redis.setex(`collectionPublishedSession:${shop}:${session.token}`,3600,raw);
   const response=await collectionCardsResponse({...entry.payload,globalSettings,products:entry.payload.products.slice((page-1)*25,page*25),rankingToken:session.token,
    cfpCards:{version:1,preview:false,published:true,publishedAt:entry.at,refreshDue},
    debug:{...entry.payload.debug,collectionRankingStatus:'ready',collectionPublishedPage:true}},'published',request,{previewLimit:25});
   if(onHit&&page===1){
    const visit=new URL(request.url);visit.searchParams.delete('rankingToken');
    Promise.resolve().then(()=>onHit({request:new Request(visit),entry,published:true,refreshDue})).catch(()=>{});
   }
   return response;
  }catch{return null;}
 }
 async function publish({request,collectionId,collectionHandle,prepared,payload,at=now(),sessionUpdatedAt,configuration,marketAvailabilityVersion=null,external=false,membershipProof=null}){
  const key=publishedCollectionKey(request);if(!key||new URL(request.url).searchParams.get('limit')!=='50')return false;
  const shop=new URL(request.url).searchParams.get('shop'),url=new URL(request.url);
  if(collectionId!=='all'){url.searchParams.delete('collectionHandle');url.searchParams.set('collectionId',String(collectionId));}
  const canonical=publishedCollectionKey(new Request(url)),aliases=new Set([key,canonical]);
  if(collectionHandle){url.searchParams.delete('collectionId');url.searchParams.set('collectionHandle',collectionHandle);aliases.add(publishedCollectionKey(new Request(url)));}
  const {rankingToken,...cards}=payload;
  const externalDependencies=external?prepared.externalDependencies||null:null;
  const externalRevision=external&&readExternalProof?await readExternalProof(shop,externalDependencies,{initialize:true}):null;
  if(external&&readExternalProof&&!externalRevision)return false;
  if(readExternalProof&&externalDependencies&&typeof prepared.reusableDataRevision==='string'&&
    prepared.reusableDataRevision.split(':')[2]!==externalRevision)return false;
  const entry={version:1,cardPresentationVersion:collectionCardPresentationVersion,marketAvailabilityVersion,...(configuration!=null?{configuration:String(configuration)}:{}),...(typeof membershipProof==='string'&&/^(?:snapshot-v1:)?[a-f0-9]{64}$/.test(membershipProof)?{membershipProof}:{}),shop,collectionId:String(collectionId),aliases:[...aliases],at,ids:prepared.ids,metadata:prepared.metadata,sessionUpdatedAt,payload:cards,external:Boolean(external),externalDependencies,externalRevision};
  if(!valid(entry))return false;
  const encoded=encodePreparation(entry);if(Buffer.byteLength(encoded)>2*1024*1024)return false;
  // Durable upsert serializes publication and rejects a delayed older builder.
  if(!await saveDurable({shop,kind:'published',key:canonical,aliases:[...aliases],collectionId:String(collectionId),payload:encoded,validatedAt:at,expiresAt:at+lifetime*1000}))return false;
  for(const alias of aliases){
   try{
    if(redis.eval)await redis.eval(`local old=redis.call('GET',KEYS[2]);if old and tonumber(old)>tonumber(ARGV[1]) then return 0 end;redis.call('SETEX',KEYS[1],ARGV[2],ARGV[3]);redis.call('SETEX',KEYS[2],ARGV[2],ARGV[1]);return 1`,2,alias,alias+':publishedAt',at,lifetime,encoded);
    else await redis.setex(alias,lifetime,encoded);
   }catch{/* The durable published version remains available. */}
   if(typeof redis.del==='function')try{await redis.del(alias+':staleStockSince');}catch{}
  }
  return true;
 }
 return {get,publish};
}
