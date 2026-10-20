import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionSalesDependencies} from '../../app/utils/collectionSalesDependencies.js';
import {createCollectionDependencies} from '../../app/utils/collectionDependencies.js';
import {createCollectionPreparation,preparationKey} from '../../app/utils/collectionPreparation.js';
import {createShopCacheInvalidation,productRevisionKey,productContentRevisionKey} from '../../app/utils/shopCacheInvalidation.js';
import {decodePreparation} from '../../app/utils/collectionPreparationPayload.js';
function fixture(){
 const values=new Map(),jobs=new Map();let time=100000,builds=0;
 const redis={get:async k=>values.get(k),mget:async(...ks)=>ks.map(k=>values.get(k)),set:async(k,v,mode)=>{if(mode==='NX'&&values.has(k)||mode==='XX'&&!values.has(k))return null;values.set(k,v);return 'OK';},setex:async(k,_ttl,v)=>values.set(k,v),ttl:async()=>3600,del:async k=>values.delete(k),incr:async k=>{const v=String(Number(values.get(k)||0)+1);values.set(k,v);return Number(v);},scan:async()=>['0',[]]};
 const queue={getJob:async k=>jobs.get(k),add:async(name,data,opts)=>{const job={name,data,opts,getState:async()=> 'waiting'};jobs.set(opts.jobId,job);return job;}};
 const scores=createCollectionSalesDependencies(redis),dependencies=createCollectionDependencies(redis);
 const spec={shop:'fixture.myshopify.com',collectionId:'1',revision:'0',retainForIdle:true,needsShopifyOrder:true,sortBy:'best-selling',orderedIds:['1','2'],query:{q:'',filter:['shop']},rule:{collectionTagMatching:'exact',conditions:[{field:'Tags',action:'Include',value:'Prom'}]}};
 let result={ids:['1','99','2'],metadata:{},sourceOutsideIds:['99']};
 const service=createCollectionPreparation({redis,queue,scores,dependencies,prepare:async()=>{builds++;return result;},now:()=>time});
 return {values,redis,queue,scores,dependencies,spec,service,jobs,builds:()=>builds,setResult:v=>result=v,advance:ms=>time+=ms,invalidate:createShopCacheInvalidation({redis})};
}
test('native score updates do not invalidate an idle Shopify-ordered ranking, while outside Include scores do',async()=>{
 const f=fixture(),{shop}=f.spec;await f.service.get(f.spec,{warmup:true,precompute:true});assert.equal(f.builds(),1);f.advance(7200000);
 await f.invalidate(shop,{kind:'scores',collectionIds:['1'],externalProof:{tags:['Prom'],ids:['1']}});
 assert.equal(f.values.get(productRevisionKey(shop,'1')),'1');assert.equal(f.values.get(productContentRevisionKey(shop,'1')),'0');
 assert.equal((await f.service.get(f.spec)).status,'ready');assert.equal(f.builds(),1);assert.equal(f.jobs.size,0);
 await f.invalidate(shop,{kind:'scores',collectionIds:['1'],externalProof:{tags:['Prom'],ids:['99']}});
 assert.equal((await f.service.get(f.spec)).status,'pending');assert.equal(f.jobs.size,1);
});
test('real content changes, unknown bulk scores and non-Shopify score ordering retain invalidation',async()=>{
 for(const kind of ['content','bulk','nonShopify']){
  const f=fixture();if(kind==='nonShopify')f.spec.needsShopifyOrder=false;
  await f.service.get(f.spec,{warmup:true,precompute:true});f.advance(7200000);
  await f.invalidate(f.spec.shop,{kind:kind==='content'?'products':'scores',collectionIds:['1'],externalProof:kind==='bulk'?undefined:{tags:['Prom'],ids:['1']}});
  assert.equal((await f.service.get(f.spec)).status,'pending',kind);
 }
});

test('an idle native-only ranking with native pins ignores score changes to those pins',async()=>{
 const f=fixture();f.spec.pinnedIds=['1'];f.setResult({ids:['1','2'],metadata:{},sourceOutsideIds:[]});
 await f.service.get(f.spec,{warmup:true,precompute:true});f.advance(7200000);
 await f.invalidate(f.spec.shop,{kind:'scores',collectionIds:['1'],externalProof:{tags:['Prom'],ids:['1']}});
 assert.equal((await f.service.get(f.spec)).status,'ready');assert.equal(f.builds(),1);assert.equal(f.jobs.size,0);
});
test('score changes during a scan cannot publish an unproven order',async()=>{
 const f=fixture();const service=createCollectionPreparation({redis:f.redis,queue:f.queue,scores:f.scores,dependencies:f.dependencies,prepare:async()=>{
  await f.scores.changed(f.spec.shop,['99']);return {ids:['1','99'],metadata:{},sourceOutsideIds:['99']};
 }});
 const result=await service.process({key:preparationKey(f.spec),spec:f.spec});assert.equal(result.superseded,true);assert.equal(f.values.has(preparationKey(f.spec)),false);
});
test('new score dependencies reject legacy proofs, missing history and other-shop writes',async()=>{
 const f=fixture();await f.service.get(f.spec,{warmup:true,precompute:true});
 const saved=decodePreparation(f.values.get(preparationKey(f.spec)));assert.equal(saved.productRevisionSource,'content-v1');
 assert.equal(await f.scores.matches(f.spec.shop,saved.salesDependencies),true);
 await f.scores.changed('other.myshopify.com',['99']);assert.equal(await f.scores.matches(f.spec.shop,saved.salesDependencies),true);
 assert.equal(await f.scores.matches(f.spec.shop,undefined),false);
 for(const key of [...f.values.keys()])if(key.startsWith('collectionSalesInput:'))f.values.delete(key);
 assert.equal(await f.scores.matches(f.spec.shop,saved.salesDependencies),false);
});

test('verified unchanged legacy rankings adopt new score proofs without a scan or extending their source age',async()=>{
 const f=fixture(),legacy=createCollectionPreparation({redis:f.redis,queue:f.queue,dependencies:f.dependencies,now:()=>100000,prepare:async()=>({ids:['1','99','2'],metadata:{},sourceOutsideIds:['99']})});
 await legacy.get(f.spec,{warmup:true,precompute:true});f.advance(7200000);
 assert.equal((await f.service.get(f.spec)).status,'ready');assert.equal(f.builds(),0);assert.equal(f.jobs.size,0);
 const saved=decodePreparation(f.values.get(preparationKey(f.spec)));assert.equal(saved.productRevisionSource,'content-v1');assert.equal(saved.preparedAt,100000);
});

test('a score event before legacy adoption requires rebuilding the legacy proof',async()=>{
 const f=fixture(),legacy=createCollectionPreparation({redis:f.redis,queue:f.queue,dependencies:f.dependencies,now:()=>100000,prepare:async()=>({ids:['1','99','2'],metadata:{},sourceOutsideIds:['99']})});
 await legacy.get(f.spec,{warmup:true,precompute:true});f.advance(7200000);await f.scores.changed(f.spec.shop,['99']);
 assert.equal((await f.service.get(f.spec)).status,'pending');assert.equal(decodePreparation(f.values.get(preparationKey(f.spec))).productRevisionSource,undefined);
});

test('a score event during legacy verification cannot relabel an old sequence as freshly proven',async()=>{
 const f=fixture(),legacy=createCollectionPreparation({redis:f.redis,queue:f.queue,dependencies:f.dependencies,now:()=>100000,prepare:async()=>({ids:['1','99','2'],metadata:{},sourceOutsideIds:['99']})});
 await legacy.get(f.spec,{warmup:true,precompute:true});f.advance(7200000);
 const upgraded=createCollectionPreparation({redis:f.redis,queue:f.queue,dependencies:f.dependencies,scores:f.scores,now:()=>7300000,prepare:async()=>{throw Error('Unexpected foreground scan');},validateReuse:async()=>{await f.scores.changed(f.spec.shop,['99']);return true;}});
 assert.equal((await upgraded.get(f.spec)).status,'pending');assert.equal(decodePreparation(f.values.get(preparationKey(f.spec))).productRevisionSource,undefined);
});
