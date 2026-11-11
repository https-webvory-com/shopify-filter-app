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
import {marketRankingFingerprint} from '../utils/marketAvailability.js';
import {collectionMembershipProof} from './collectionFilterMembership.server.js';
import {createCollectionDependencies,dependencyAnyKey} from '../utils/collectionDependencies.js';
import {catalogPublicationInvalidatedAtKey,marketRuleInvalidatedAtKey} from '../utils/shopCacheInvalidation.js';
const recordCardEvent=createCollectionPreparationTelemetry(redis);
const externalDependencies=createCollectionDependencies(redis);
const readExternalProof=async(shop,descriptor,{initialize=false}={})=>{
 if(descriptor)return externalDependencies.revision(shop,descriptor,{initialize});
 let value=await redis.get(dependencyAnyKey(shop));
 if(!value&&initialize){await redis.set(dependencyAnyKey(shop),'initial','NX');value=await redis.get(dependencyAnyKey(shop));}
 return value;
};

export function createCardStateReader(redis,database=prisma,now=Date.now,loadDurable=loadCollectionLoadingSnapshot){return readCardState(redis,database,now,loadDurable,getCollectionLoadingGeneration);}

const createSession=(request,entry,prepared)=>{
 const base=marketRankingFingerprint(collectionRankingFingerprint(request.url),entry.marketAvailabilityVersion);
 return saveCollectionRankingSession(entry.shop,entry.priceSortField?`${base}:price:${entry.priceSortField}`:base,prepared.ids,entry.sessionUpdatedAt,prepared.metadata,entry.membershipProof);
};
const readGlobalSettings = async shop=>{
 const settings=await prisma.filterGlobalSetting.findUnique({where:{shop}});
 if(!settings)return null;
 return {...settings,desktopFilterLayout:settings.integrations?.desktopFilterLayout||(settings.horizontalFilters?'horizontal':'drawer')};
};
const publishedPages=createPublishedCollectionPages({redis,loadDurable:loadCollectionLoadingSnapshot,saveDurable:saveCollectionLoadingSnapshot,createSession,
 readConfigurationRevision:async shop=>await redis.get(`collectionPreparationRevision:${shop}`)??'0',
 readCatalogInvalidatedAt:async(shop,id)=>await redis.get(catalogPublicationInvalidatedAtKey(shop,id)),
 readMarketRuleInvalidatedAt:async(shop,country)=>country?await redis.get(marketRuleInvalidatedAtKey(shop,country)):null,
 readExternalProof,
 readGlobalSettings,
});
const store=createCollectionCardStore({redis,readState:createCardStateReader(redis),loadDurable:loadCollectionLoadingSnapshot,saveDurable:saveCollectionLoadingSnapshot,publishedPages,readGlobalSettings,
 observe:event=>recordCardEvent(event).catch(()=>{}),
 validateCards:(entry,prepared,options)=>validateCollectionCardDocuments(meili.index('products'),entry,prepared,{...options,batchOwner:meili}),
 createSession,
 makeMembershipProof:(spec,collectionId)=>collectionMembershipProof({shop:spec.shop,collectionId,configuration:spec.revision,marketVersion:spec.marketAvailabilityVersion,rule:spec.rule,pinningRule:spec.pinningRule,mergedValues:spec.mergedValues,globalSettings:spec.globalSettings,orderRevision:spec.orderRevision}),
});
export const getPreparedCollectionCards=store.get;
export const getPreparedCollectionFilters=(request,options)=>publishedPages.get(request,{...options,filtersOnly:true});
export const beginPreparedCollectionCards=options=>{
 if(!options.spec)return store.begin(options);
 const canonicalKey=preparationKey(options.spec);
 // A retained older order can keep an existing page usable during a refresh,
 // but must not be promoted to a new long-lived first-page snapshot.
 if(options.preparedKey&&options.preparedKey!==canonicalKey)return null;
 return store.begin({...options,preparedKey:canonicalKey});
};
