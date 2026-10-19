import {createCardStateReader as readCardState} from '../utils/collectionCardState.js';
import redis from './redis.server.js';
import prisma from '../db.server.js';
import meili from './meiliClient.server.js';
import {createCollectionCardStore} from '../utils/collectionCardStore.js';
import {preparationKey} from '../utils/collectionPreparation.js';
import {readRankedCollectionPage} from '../utils/rankedCollectionPage.js';
import {collectionPageFingerprint} from '../utils/collectionResponse.js';
import {collectionRankingFingerprint,saveCollectionRankingSession} from './collectionRankingSession.server.js';
import {loadCollectionLoadingSnapshot,saveCollectionLoadingSnapshot,getCollectionLoadingGeneration} from './collectionLoadingSnapshots.server.js';

export function createCardStateReader(redis,database=prisma,now=Date.now,loadDurable=loadCollectionLoadingSnapshot){return readCardState(redis,database,now,loadDurable,getCollectionLoadingGeneration);}

const store=createCollectionCardStore({redis,readState:createCardStateReader(redis),loadDurable:loadCollectionLoadingSnapshot,saveDurable:saveCollectionLoadingSnapshot,
 validateCards:async(entry,prepared)=>{
  const result=await readRankedCollectionPage(meili.index('products'),{ids:prepared.ids,page:1,limit:25,shop:entry.shop,batchOwner:meili,attributes:entry.attributes});
  return collectionPageFingerprint(result.hits)===entry.validationFingerprint;
 },
 createSession:(request,entry,prepared)=>saveCollectionRankingSession(entry.shop,collectionRankingFingerprint(request.url),prepared.ids,entry.sessionUpdatedAt,prepared.metadata),
});
export const getPreparedCollectionCards=store.get;
export const beginPreparedCollectionCards=options=>{
 const canonicalKey=preparationKey(options.spec);
 // A retained older order can keep an existing page usable during a refresh,
 // but must not be promoted to a new long-lived first-page snapshot.
 if(options.preparedKey&&options.preparedKey!==canonicalKey)return null;
 return store.begin({...options,preparedKey:canonicalKey});
};
