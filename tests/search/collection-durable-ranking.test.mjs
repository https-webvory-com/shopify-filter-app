import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionPreparation,preparationKey} from '../../app/utils/collectionPreparation.js';
import {productRevisionKey,rankingDataRevisionKey} from '../../app/utils/shopCacheInvalidation.js';

function fixture(){
 const values=new Map(),disk=new Map(),jobs=[];let builds=0,clock=100000;
 const redis={get:async k=>values.get(k),setex:async(k,t,v)=>values.set(k,v),del:async k=>values.delete(k),ttl:async()=>600};
 const spec={shop:'fixture.myshopify.com',collectionId:'1',retainForIdle:true,revision:'0',sortBy:'best-selling',query:{},rule:{conditions:[]}};
 const service=createCollectionPreparation({redis,queue:{getJob:async()=>null,add:async(...a)=>jobs.push(a)},now:()=>clock,
  prepare:async()=>{builds++;return {ids:['1','2'],metadata:{'1':{merchandisingImage:'selected.jpg'}}};},
  loadDurable:async({key})=>disk.get(key),saveDurable:async({key,payload})=>disk.set(key,payload)});
 return {service,redis,spec,values,disk,jobs,builds:()=>builds,advance:n=>clock+=n};
}
test('a retained ranking survives Redis eviction without scanning or waiting for another worker',async()=>{
 const f=fixture();await f.service.get(f.spec,{warmup:true,precompute:true});assert.equal(f.builds(),1);
 f.values.delete(preparationKey(f.spec));const result=await f.service.get(f.spec);
 assert.equal(result.status,'ready');assert.deepEqual(result.ids,['1','2']);assert.equal(result.metadata['1'].merchandisingImage,'selected.jpg');assert.equal(f.builds(),1);assert.equal(f.jobs.length,0);
});
test('durable rankings cannot bypass configuration, stock, hard epochs or retention',async()=>{
 for(const change of ['configuration','product','hard','expired','corrupt']){
  const f=fixture();await f.service.get(f.spec,{warmup:true,precompute:true});f.values.clear();
  if(change==='configuration')f.spec={...f.spec,revision:'1'};
  if(change==='product')f.values.set(productRevisionKey(f.spec.shop,'1'),'1');
  if(change==='hard')f.values.set(rankingDataRevisionKey(f.spec.shop,'1'),'1');
  if(change==='expired')f.advance(86400001);
  if(change==='corrupt')f.disk.set(preparationKey(f.spec),'{bad');
  const result=await f.service.get(f.spec);assert.notEqual(result.status,'ready',change);assert.equal(f.builds(),1);
 }
});
test('optional durable write failures cannot fail a completed ranking',async()=>{
 const f=fixture();const service=createCollectionPreparation({redis:f.redis,queue:{},now:()=>100000,prepare:async()=>({ids:['1'],metadata:{}}),saveDurable:async()=>{throw Error('Missing migration');}});
 const result=await service.get(f.spec,{warmup:true,precompute:true});assert.equal(result.status,'ready');
});
