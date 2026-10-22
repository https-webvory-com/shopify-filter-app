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
const publishedPages=createPublishedCollectionPages({redis,loadDurable:loadCollectionLoadingSnapshot,saveDurable:saveCollectionLoadingSnapshot,createSession});
const store=createCollectionCardStore({redis,readState:createCardStateReader(redis),loadDurable:loadCollectionLoadingSnapshot,saveDurable:saveCollectionLoadingSnapshot,publishedPages,
 observe:event=>recordCardEvent(event).catch(()=>{}),
 validateCards:(entry,prepared,options)=>validateCollectionCardDocuments(meili.index('products'),entry,prepared,{...options,batchOwner:meili}),
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
