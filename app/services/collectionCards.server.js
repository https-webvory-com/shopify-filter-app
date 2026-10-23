import {getMarketAvailableProductIds,marketAvailabilityVersion} from './marketAvailability.server.js';
import {createCardStateReader as readCardState} from '../utils/collectionCardState.js';
import redis from './redis.server.js';
import prisma from '../db.server.js';
import meili from './meiliClient.server.js';
import {createCollectionCardStore} from '../utils/collectionCardStore.js';
import {preparationKey} from '../utils/collectionPreparation.js';
import {validateCollectionCardDocuments} from '../utils/collectionCardValidation.js';
import {collectionRankingFingerprint,saveCollectionRankingSession} from './collectionRankingSession.server.js';
import {loadCollectionLoadingSnapshot,saveCollectionLoadingSnapshot,getCollectionLoadingGeneration} from './collectionLoadingSnapshots.server.js';
import {createCollectionPreparationTelemetry} from '../utils/collectionPreparationTelemetry.js';
import {createPublishedCollectionPages} from '../utils/collectionPublishedPage.js';
const recordCardEvent=createCollectionPreparationTelemetry(redis);

export function createCardStateReader(redis,database=prisma,now=Date.now,loadDurable=loadCollectionLoadingSnapshot){return readCardState(redis,database,now,loadDurable,getCollectionLoadingGeneration);}

const createSession=(request,entry,prepared)=>saveCollectionRankingSession(entry.shop,collectionRankingFingerprint(request.url),prepared.ids,entry.sessionUpdatedAt,prepared.metadata);
const publishedPages=createPublishedCollectionPages({redis,loadDurable:loadCollectionLoadingSnapshot,saveDurable:saveCollectionLoadingSnapshot,createSession,
 readMarketAvailabilityRevision:async(shop,country)=>{const ids=await getMarketAvailableProductIds(shop,country);return ids?marketAvailabilityVersion(ids):null;},
 readConfigurationRevision:async shop=>await redis.get(`collectionPreparationRevision:${shop}`)??'0',
 validateProducts:async({shop,products,globalSettings,request})=>{
  const ids=products.map(p=>`gid://shopify/Product/${String(p.id).split('/').pop()}`);
  if(!ids.length)return true;
  const count=await prisma.product.count({where:{shop,id:{in:ids},status:'active',
   ...(globalSettings?.showOnlyInStock===true?{variants:{some:{available:true}}}:{})}});
  if(count!==ids.length)return false;
  if(globalSettings?.showOnlyInStock===true){const available=await getMarketAvailableProductIds(shop,new URL(request.url).searchParams.get('country'));if(!available)return false;const allowed=new Set(available);return ids.every(id=>allowed.has(id.split('/').pop()));}
  return true;
 },
 readGlobalSettings:async shop=>{
  const settings=await prisma.filterGlobalSetting.findUnique({where:{shop}});
  if(!settings)return null;
  return {...settings,desktopFilterLayout:settings.integrations?.desktopFilterLayout||(settings.horizontalFilters?'horizontal':'drawer')};
 },
});
const store=createCollectionCardStore({redis,readState:createCardStateReader(redis),loadDurable:loadCollectionLoadingSnapshot,saveDurable:saveCollectionLoadingSnapshot,publishedPages,
 observe:event=>recordCardEvent(event).catch(()=>{}),
 validateCards:async(entry,prepared,options)=>{
  if(entry.payload?.globalSettings?.showOnlyInStock===true){
   const available=await getMarketAvailableProductIds(entry.shop,new URL(options.request.url).searchParams.get('country'));
   if(!available||entry.marketAvailabilityRevision!==marketAvailabilityVersion(available))return false;const allowed=new Set(available);
   if(!entry.payload.products.every(p=>allowed.has(String(p.id).split('/').pop())))return false;
  }
  return validateCollectionCardDocuments(meili.index('products'),entry,prepared,{...options,batchOwner:meili});
 },
 createSession,
});
export const getPreparedCollectionCards=store.get;
export const beginPreparedCollectionCards=options=>{
 if(!options.spec)return store.begin(options);
 const canonicalKey=preparationKey(options.spec);
 // A retained older order can keep an existing page usable during a refresh,
 // but must not be promoted to a new long-lived first-page snapshot.
 if(options.preparedKey&&options.preparedKey!==canonicalKey)return null;
 return store.begin({...options,preparedKey:canonicalKey});
};
