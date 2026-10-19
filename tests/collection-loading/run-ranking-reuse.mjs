import assert from 'node:assert/strict';
import {createRedisTestLayer} from './redis-layer.mjs';
import {createCollectionPreparation,preparationKey} from '../../app/utils/collectionPreparation.js';
import {createShopCacheInvalidation,configurationRevisionKey} from '../../app/utils/shopCacheInvalidation.js';

const layer=await createRedisTestLayer();
try{
 await layer.worker.pause();
 const shop='ranking-reuse.myshopify.com',invalidate=createShopCacheInvalidation({redis:layer.redis});let builds=0;
 const service=createCollectionPreparation({redis:layer.redis,queue:layer.queue,retentionLimit:3,prepare:async()=>{builds++;return {ids:['2','1'],metadata:{'2':{merchandisingImage:'pin.jpg'}}};}});
 const spec={shop,collectionId:'1',revision:'0',retainForIdle:true,needsShopifyOrder:true,orderedIds:['2','1'],query:{q:'',filter:[`shop = '${shop}'`]},rule:{conditions:[]}};
 assert.equal((await service.get(spec,{warmup:true,precompute:true})).status,'ready');
 const source=await layer.redis.get(preparationKey(spec));
 await invalidate(shop);
 assert.equal(await layer.redis.get(preparationKey(spec)),source);
 const current={...spec,revision:String(await layer.redis.get(configurationRevisionKey(shop)))};
 assert.deepEqual((await service.get(current)).ids,['2','1']);assert.equal(builds,1);
 await invalidate(shop,{kind:'catalog',collectionIds:['2']});
 assert.equal((await service.get({...spec,revision:'2'})).status,'ready');assert.equal(builds,1);
 await invalidate(shop,{kind:'catalog',collectionIds:['1']});
 assert.equal((await service.get({...spec,revision:'3'})).status,'pending');assert.equal(builds,1);
 await layer.queue.drain(true);
 await invalidate(shop,{kind:'catalog'});
 assert.equal((await service.get({...spec,revision:'4'})).status,'pending');assert.equal(builds,1);
 await layer.queue.drain(true);
 const protectedKey=layer.physical('collectionRankingSession:'+shop+':protected');
 await layer.client.set(protectedKey,'keep');
 await layer.client.zadd(layer.physical('collectionPreparationReuseRetention:'+shop),0,protectedKey);
 for(let i=0;i<5;i++)await service.get({...spec,collectionId:'scope-'+i,revision:'4'},{warmup:true,precompute:true});
 assert.equal(await layer.client.zcard(layer.physical('collectionPreparationReuseRetention:'+shop)),3);
 assert.equal(await layer.client.get(protectedKey),'keep');
 console.log('PASS: Redis reuses unchanged rankings without a scan, rejects scoped/bulk data changes, bounds reuse pointers, preserves protected session keys');
}finally{await layer.close();}
