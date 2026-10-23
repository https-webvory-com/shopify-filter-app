import {hasUsableExtraFacets} from './extraProductFilters.js';
import {hasUsableSaleFacets} from './percentSaleFilter.js';
import {createHash} from 'node:crypto';
import {encodePreparation,decodePreparation} from './collectionPreparationPayload.js';
import {hasUsableProductTitleFacets} from './productTitleFilter.js';
import {hasUsableCollectionNavigation} from './collectionNavigation.js';
import {isPublicCollectionCards,collectionCardsResponse,acceptsPublishedCollectionPage,collectionCardPresentationVersion} from './collectionCards.js';

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
export function createPublishedCollectionPages({redis,loadDurable,saveDurable,createSession,readGlobalSettings,readConfigurationRevision,now=Date.now,lifetime=86400}){
 const valid=(entry,serving=false)=>entry?.version===1&&entry.cardPresentationVersion===collectionCardPresentationVersion&&Number.isFinite(entry.at)&&entry.at<=now()&&(serving||now()-entry.at<lifetime*1000)&&
  Array.isArray(entry.ids)&&new Set(entry.ids).size===entry.ids.length&&entry.ids.every(id=>/^\d+$/.test(id))&&
  Number.isSafeInteger(entry.payload?.totalCount)&&entry.payload.totalCount===entry.ids.length&&
  Array.isArray(entry.payload.products)&&entry.payload.products.length===Math.min(50,entry.ids.length)&&
  entry.payload.products.every((p,i)=>String(p.id).split('/').pop()===entry.ids[i]&&p.title&&p.handle)&&
  entry.payload.settings&&entry.payload.facets&&hasUsableExtraFacets(entry.payload)&&hasUsableSaleFacets(entry.payload)&&hasUsableProductTitleFacets(entry.payload)&&hasUsableCollectionNavigation(entry.payload);
 async function get(request,{onHit}={}){
  const key=publishedCollectionKey(request);if(!key||!acceptsPublishedCollectionPage(request))return null;
  const params=new URL(request.url).searchParams,shop=params.get('shop'),page=Number(params.get('page')),token=params.get('rankingToken');
  if(params.get('limit')!=='25'||page===2&&!/^[a-f0-9-]{36}$/.test(token||''))return null;
  try{
   let raw;try{raw=await redis.get(page===2?`collectionPublishedSession:${shop}:${token}`:key);}catch{}
   if(!raw&&loadDurable)raw=await loadDurable({shop,kind:'published',key});
   if(!raw||Buffer.byteLength(raw)>2*1024*1024)return null;
   const entry=decodePreparation(raw);if(entry.shop!==shop||!entry.aliases?.includes(key)||!valid(entry,true))return null;
   // Retire stock-restricted publications from the reverted release, as well
   // as publications with an obsolete pin or merchandising configuration.
   if(page===1&&(entry.marketAvailabilityRevision!=null||(readConfigurationRevision&&entry.configuration!==String(await readConfigurationRevision(shop))))){
    if(onHit){const visit=new URL(request.url);visit.searchParams.delete('rankingToken');
     Promise.resolve().then(()=>onHit({request:new Request(visit),entry,published:true,refreshDue:true})).catch(()=>{});
    }
    return null;
   }
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
   const session=await createSession(request,entry,{ids:entry.ids,metadata:entry.metadata});
   if(page===2&&session.token!==token)return null;
   // One immutable copy per shared ranking token keeps page two on the same
   // published version even if a replacement is published between clicks.
   if(page===1)await redis.setex(`collectionPublishedSession:${shop}:${session.token}`,3600,raw);
   const response=await collectionCardsResponse({...entry.payload,globalSettings,products:entry.payload.products.slice((page-1)*25,page*25),rankingToken:session.token,
    cfpCards:{version:1,preview:false,published:true,publishedAt:entry.at,refreshDue:now()-entry.at>=lifetime*1000},
    debug:{...entry.payload.debug,collectionRankingStatus:'ready',collectionPublishedPage:true}},'published',request,{previewLimit:25});
   if(onHit&&page===1){
    const visit=new URL(request.url);visit.searchParams.delete('rankingToken');
    Promise.resolve().then(()=>onHit({request:new Request(visit),entry,published:true,refreshDue:now()-entry.at>=lifetime*1000})).catch(()=>{});
   }
   return response;
  }catch{return null;}
 }
 async function publish({request,collectionId,collectionHandle,prepared,payload,at=now(),sessionUpdatedAt,configuration}){
  const key=publishedCollectionKey(request);if(!key||new URL(request.url).searchParams.get('limit')!=='50')return false;
  const shop=new URL(request.url).searchParams.get('shop'),url=new URL(request.url);
  url.searchParams.delete('collectionHandle');url.searchParams.set('collectionId',String(collectionId));
  const canonical=publishedCollectionKey(new Request(url)),aliases=new Set([key,canonical]);
  if(collectionHandle){url.searchParams.delete('collectionId');url.searchParams.set('collectionHandle',collectionHandle);aliases.add(publishedCollectionKey(new Request(url)));}
  const {rankingToken,...cards}=payload;
  const entry={version:1,cardPresentationVersion:collectionCardPresentationVersion,...(configuration!=null?{configuration:String(configuration)}:{}),shop,collectionId:String(collectionId),aliases:[...aliases],at,ids:prepared.ids,metadata:prepared.metadata,sessionUpdatedAt,payload:cards};
  if(!valid(entry))return false;
  const encoded=encodePreparation(entry);if(Buffer.byteLength(encoded)>2*1024*1024)return false;
  // Durable upsert serializes publication and rejects a delayed older builder.
  if(!await saveDurable({shop,kind:'published',key:canonical,aliases:[...aliases],collectionId:String(collectionId),payload:encoded,validatedAt:at,expiresAt:at+lifetime*1000}))return false;
  for(const alias of aliases){
   try{
    if(redis.eval)await redis.eval(`local old=redis.call('GET',KEYS[2]);if old and tonumber(old)>tonumber(ARGV[1]) then return 0 end;redis.call('SETEX',KEYS[1],ARGV[2],ARGV[3]);redis.call('SETEX',KEYS[2],ARGV[2],ARGV[1]);return 1`,2,alias,alias+':publishedAt',at,lifetime,encoded);
    else await redis.setex(alias,lifetime,encoded);
   }catch{/* The durable published version remains available. */}
  }
  return true;
 }
 return {get,publish};
}
