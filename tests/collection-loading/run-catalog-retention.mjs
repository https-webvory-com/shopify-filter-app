import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRedisTestLayer} from './redis-layer.mjs';
import {createCollectionPreparation,preparationKey,publicRetentionKey,publicRetentionSizesKey} from '../../app/utils/collectionPreparation.js';
import {decodePreparation} from '../../app/utils/collectionPreparationPayload.js';

const layer=await createRedisTestLayer(),results=[];
const shop='catalog-retention.myshopify.com';
const base={shop,revision:'0',retainForIdle:true,needsShopifyOrder:true,query:{},orderedIds:['1','2']};
try{
 await layer.worker.pause();
 const service=createCollectionPreparation({redis:layer.redis,queue:layer.queue,prepare:async()=>({ids:['2','1'],metadata:{}})});
 const specs=Array.from({length:60},(_,i)=>({...base,collectionId:String(i)}));
 for(let i=0;i<specs.length;i+=10)await Promise.all(specs.slice(i,i+10).map(spec=>service.process({key:preparationKey(spec),spec})));
 assert.equal(await layer.client.zcard(layer.physical(publicRetentionKey(shop))),60);
 for(const spec of [specs[0],specs[39],specs[59]])assert.equal((await service.get(spec)).status,'ready');
 results.push('More than forty unseen collection rankings remain usable');

 const large={...base,collectionId:'large'};
 const ids=Array.from({length:23000},(_,i)=>String(15000000000000+i));
 const compressed=createCollectionPreparation({redis:layer.redis,queue:layer.queue,prepare:async()=>({ids,metadata:{}})});
 await compressed.process({key:preparationKey(large),spec:large});
 const raw=await layer.redis.get(preparationKey(large));assert.ok(raw.startsWith('z1:'));assert.deepEqual(decodePreparation(raw).ids,ids);
 assert.deepEqual((await compressed.get(large)).ids,ids);
 results.push('Compressed full ranking round-trips through real Redis with exact order');

 const budgetShop='catalog-budget.myshopify.com';
 const bounded=createCollectionPreparation({redis:layer.redis,queue:layer.queue,retentionBytes:1800,prepare:async()=>({ids:['1'],metadata:{'1':{merchandisingImage:'x'.repeat(900)}}})});
 const first={...base,shop:budgetShop,collectionId:'1'},second={...first,collectionId:'2'};
 const protectedKey=layer.physical('collectionRankingSession:'+budgetShop+':protected');await layer.client.set(protectedKey,'untouched');
 await layer.client.zadd(layer.physical(publicRetentionKey(budgetShop)),0,protectedKey);
 await bounded.process({key:preparationKey(first),spec:first});await bounded.process({key:preparationKey(second),spec:second});
 assert.equal(await layer.redis.get(preparationKey(first)),null);assert.equal((await bounded.get(second)).status,'ready');
 assert.equal(await layer.client.get(protectedKey),'untouched');
 const sizes=await layer.client.hvals(layer.physical(publicRetentionSizesKey(budgetShop)));
 assert.ok(sizes.reduce((sum,v)=>sum+Number(v),0)<=1800);
 results.push('Atomic byte budget evicts only owned rankings and preserves browsing sessions');
 fs.mkdirSync('scratch/catalog-first-visit-20261019',{recursive:true});
 fs.writeFileSync('scratch/catalog-first-visit-20261019/redis-retention.json',JSON.stringify({passed:true,results},null,2));
 console.log(JSON.stringify({passed:true,results}));
}finally{await layer.close();}
