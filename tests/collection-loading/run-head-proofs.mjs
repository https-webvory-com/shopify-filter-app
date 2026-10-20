import assert from 'node:assert/strict';
import {createRedisTestLayer} from './redis-layer.mjs';
import {createCollectionHeadProofs} from '../../app/utils/collectionHeadProofs.js';
const layer=await createRedisTestLayer();
try{
 const events=[],version='a'.repeat(64),spec={shop:'head-proof-fixture.myshopify.com',collectionId:'1',revision:'1',sortBy:'best-selling',query:{country:'IN',locale:'en'}};
 const service=createCollectionHeadProofs({redis:layer.redis,readVersion:async()=>version,observe:event=>events.push(event),maxEntries:2,now:()=>1000});
 const ids=['1','2','3','4','5'];
 for(const collectionId of ['1','2','3'])assert.equal(await service.remember({...spec,collectionId},version,ids),true);
 assert.equal(await service.compare(spec,{ids}),null,'oldest proof must be evicted by the Lua retention budget');
 assert.equal(await service.compare({...spec,collectionId:'2'},{ids}),'match');
 assert.equal(await service.compare({...spec,collectionId:'3'},{ids:['1','9','3','4','5']}),'mismatch');
 assert.equal(await service.blocked(spec,version),true);assert.equal(await service.blocked({...spec,shop:'other.myshopify.com'},version),false);
 assert.equal(events.find(e=>e.event==='head-comparison-mismatch').position,1);
 console.log('Real Redis head-proof retention, shadow comparison, mismatch block and tenant isolation PASS');
}finally{await layer.close();}
