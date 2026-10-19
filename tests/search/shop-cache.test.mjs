import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as invalidation from '../../app/utils/shopCacheInvalidation.js';

async function fixture() {
 const values=new Map();
 const warmups=[];
 const redis={get:async key=>values.get(key),setex:async(key,ttl,value)=>values.set(key,value),
   incr:async key=>{const v=Number(values.get(key)||0)+1;values.set(key,String(v));return v;},
   scan:async()=>['0',[...values.keys()]],del:async(...keys)=>{keys.forEach(key=>values.delete(key));return keys.length;}};
 const context={module:{exports:{}},exports:{},console,queue:{add:async(...args)=>warmups.push(args)},require:name=>name.includes('shopCacheInvalidation')?invalidation:({__esModule:true,default:redis})};
 const source=(await fs.readFile('app/services/shopCache.server.js','utf8')).replace("await import('./collectionPreparation.server.js')",'({scheduleCollectionWarmup:(shop,collectionIds)=>queue.add("COLLECTION_RANKING_WARM",{shop,collectionIds})})');
 vm.runInNewContext((await transform(source,{format:'cjs'})).code,context);
 return {...context.module.exports,values,warmups};
}

test('concurrent cache misses share one expensive ranking preparation',async()=>{
 const {getCached}=await fixture();let calls=0,release;
 const prepare=async()=>{calls++;await new Promise(resolve=>{release=resolve;});return {ids:['1','2']};};
 const a=getCached('ranking',prepare,600),b=getCached('ranking',prepare,600);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 release();assert.deepEqual(await a,await b);
 await getCached('ranking',prepare,600);assert.equal(calls,1);
});

test('failed ranking preparations can be retried',async()=>{
 const {getCached}=await fixture();
 await assert.rejects(getCached('ranking',async()=>{throw Error('search down');}),/search down/);
 assert.equal(await getCached('ranking',async()=>42),42);
});

test('search ranking candidates follow product revisions written by another process',async()=>{
 const f=await fixture(),shop='fixture.myshopify.com',key='searchRankingCandidates:'+shop+':phrase';
 assert.equal(await f.getCached(key,async()=>1,15),1);
 f.values.set('collectionProductRevision:'+shop+':all','1');
 assert.equal(await f.getCached(key,async()=>2,15),2);
 assert.ok(f.values.has(key+':revision:0:1'));
});

test('admin invalidation preserves browsing sessions, advances revision and schedules warmup',async()=>{
 const f=await fixture();
 for(const prefix of ['collectionRankingSession:','collectionOrderSnapshot:','collectionWarmupContexts:'])f.values.set(prefix+'shop','retained');
 f.values.set('collectionPreparedSequence:shop:old','obsolete');f.values.set('globalSettings:shop','obsolete');
 await f.invalidateShop('shop');
 assert.equal(f.values.get('collectionPreparationRevision:shop'),'1');
 assert.equal(f.values.get('collectionPreparedSequence:shop:old'),'obsolete');
 assert.equal(f.values.has('globalSettings:shop'),false);
 for(const prefix of ['collectionRankingSession:','collectionOrderSnapshot:','collectionWarmupContexts:'])assert.equal(f.values.get(prefix+'shop'),'retained');
 assert.equal(f.warmups[0][0],'COLLECTION_RANKING_WARM');assert.equal(f.warmups[0][1].shop,'shop');
});

test('a config fetch started before an admin save cannot resurrect its old cache value',async()=>{
 const f=await fixture();let release;
 const pending=f.getCached('globalSettings:shop',()=>new Promise(resolve=>release=resolve));
 await new Promise(resolve=>setImmediate(resolve));await f.invalidateShop('shop');release({old:true});await pending;
 assert.equal(f.values.has('globalSettings:shop'),false);
 assert.deepEqual(await f.getCached('globalSettings:shop',async()=>({updated:true})),{updated:true});
});

test('a configuration write from another process cannot enter the new revision namespace',async()=>{
 const f=await fixture();const key='globalSettings:fixture.myshopify.com';let release;
 const pending=f.getCached(key,()=>new Promise(resolve=>release=resolve));
 await new Promise(resolve=>setImmediate(resolve));
 // Represents a save in another process, without changing this process's epoch.
 f.values.set('collectionPreparationRevision:fixture.myshopify.com','1');
 release({old:true});await pending;
 assert.ok(f.values.has(key+':revision:0:0'));
 assert.deepEqual(await f.getCached(key,async()=>({updated:true})),{updated:true});
 assert.equal(JSON.parse(f.values.get(key+':revision:1:0')).updated,true);
});

test('cache diagnostics retain the existing size and keys fields',async()=>{
 const f=await fixture();
 f.values.set('fixture:cache','value');
 const stats=await f.getCacheStats();
 assert.equal(stats.size,1);
 assert.equal(stats.ttlSec,60);
 assert.deepEqual(Array.from(stats.keys),['fixture:cache']);
});
