import assert from 'node:assert/strict';
import {createRedisTestLayer} from './redis-layer.mjs';
import {createCollectionCardStore,collectionCardKey} from '../../app/utils/collectionCardStore.js';
import {encodePreparation} from '../../app/utils/collectionPreparationPayload.js';
const layer=await createRedisTestLayer();
try{
 const shop='cards-fixture.myshopify.com',source='collectionPreparedSequence:'+shop+':background-v2:'+'a'.repeat(64),protectedKey='collectionRankingSession:'+shop+':protected';
 await layer.redis.set(protectedKey,'preserve');let clock=Date.now(),sessions=0;
 const prepared={ids:['1'],metadata:{},preparedAt:clock,productRevision:'0',reusableDataRevision:'0:0'};
 const store=createCollectionCardStore({redis:layer.redis,now:()=>clock,maxEntries:2,readBudgetMs:10000,readState:async()=>({configuration:'0',products:'0',globalProducts:'0',hardAll:'0',hardCollection:'0',orderRevision:'order',preparedRaw:encodePreparation(prepared)}),validateCards:async()=>true,createSession:async()=>({token:'visitor-'+(++sessions)})});
 const requests=[];
 for(const country of ['IN','US','CA']){
  const request=new Request('https://fixture/api/filter?shop='+shop+'&collectionId=1&country='+country+'&locale=en&sortBy=best-selling&page=1&limit=25&responseProfile=collection-cards-v1');requests.push(request);clock++;
  const lease=await store.begin({request,spec:{shop,collectionId:'1',retainForIdle:true,revision:'0'},preparedKey:source,rankingSession:{ids:prepared.ids,metadata:{}},attributes:['id']});assert.ok(lease);assert.equal(await lease.finish({products:[{id:'1'}],settings:[],totalCount:1},'fp'),true);
 }
 assert.equal(sessions,0);assert.equal(await layer.redis.get(collectionCardKey(requests[0])),null);assert.ok(await store.get(requests[2]));assert.equal(sessions,1);assert.ok(await layer.redis.ttl(collectionCardKey(requests[2]))>0);
 // Polluted retention metadata must never delete a browsing session key.
 await layer.client.zadd(layer.physical('collectionFirstPage:'+shop+':retention'),0,layer.physical(protectedKey));
 await layer.client.hset(layer.physical('collectionFirstPage:'+shop+':sizes'),layer.physical(protectedKey),1);
 const lease=await store.begin({request:requests[2],spec:{shop,collectionId:'1',retainForIdle:true,revision:'0'},preparedKey:source,rankingSession:{ids:prepared.ids,metadata:{}},attributes:['id']});await lease.finish({products:[{id:'1'}],settings:[],totalCount:1},'fp');
 assert.equal(await layer.redis.get(protectedKey),'preserve');console.log('PASS real Redis cards: bounded retention, expiry, visitor-only sessions, protected keys');
}finally{await layer.close();}
