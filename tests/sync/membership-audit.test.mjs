import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import vm from 'node:vm';import {transform} from 'esbuild';import {createHash} from 'node:crypto';
const shop='fixture.myshopify.com',cid='gid://shopify/Collection/1';
async function fixture({repairError,fullSync=false,queued=false,catalogError=false}={}){
 const cache=new Map(),added=[],calls=[];const collection={id:cid,title:'Test',handle:'test'};
 if(!catalogError)cache.set('membershipPublishedCatalog:'+shop,JSON.stringify([collection]));
 const redis={get:async k=>cache.get(k),set:async(k,v)=>{cache.set(k,v);calls.push(k);},setex:async(k,_t,v)=>cache.set(k,v)};
 const prisma={collection:{findMany:async()=>[{shop}],findUnique:async()=>({shop}),upsert:async()=>{}},syncJob:{findFirst:async()=>fullSync?{id:'sync'}:null}};
 const queue={getJob:async()=>queued?{getState:async()=>'active'}:null,add:async(...a)=>added.push(a)};
 const source=(await fs.readFile('app/services/collectionMembershipAudit.server.js','utf8')).replaceAll('await import(','await dependency(');
 const mocks={'./redis.server.js':{__esModule:true,default:redis},'../db.server.js':{__esModule:true,default:prisma},'./queue.server.js':{collectionMembershipQueue:queue},'node:crypto':{createHash}};
 const ctx={module:{exports:{}},exports:{},console:{log(){}},require:k=>mocks[k],dependency:async k=>{
  if(k==='../shopify.server.js')return{unauthenticated:{admin:async()=>({admin:{graphql:async()=>({json:async()=>({errors:[{}]})})}})}};
  if(k==='./sync.server.js')return{syncCollectionProducts:async()=>{if(repairError)throw repairError;return{verified:true,repaired:0,products:10};}};
  throw Error('Unexpected dependency '+k);
 }};
 vm.runInNewContext((await transform(source,{format:'cjs'})).code,ctx);
 return{service:ctx.module.exports,cache,calls,added};
}
test('rolling audits deduplicate active work and defer during a full sync',async()=>{
 for(const options of [{queued:true},{fullSync:true}]){const f=await fixture(options);await f.service.scheduleMembershipAudits();assert.equal(f.added.length,0);}
 const f=await fixture();await f.service.scheduleMembershipAudits();assert.equal(f.added.length,1);assert.equal(f.added[0][1].shop,shop);
});
test('only successfully verified audits advance the cursor',async()=>{
 const f=await fixture();await f.service.processMembershipAudit({shop});assert.equal(f.cache.get('membershipAuditCursor:'+shop),cid);assert.equal(JSON.parse(f.cache.get('membershipAuditStatus:'+shop)).verified,true);
 const bad=await fixture({repairError:Error('index unavailable')});await assert.rejects(bad.service.processMembershipAudit({shop}));assert.equal(bad.cache.get('membershipAuditCursor:'+shop),undefined);const status=JSON.parse(bad.cache.get('membershipAuditStatus:'+shop));assert.equal(status.verified,false);assert.equal(status.collectionId,cid);
});
test('incomplete published catalog and invalid tenant abort without advancing',async()=>{
 const f=await fixture({catalogError:true});await assert.rejects(f.service.processMembershipAudit({shop}),/catalog unavailable/);assert.equal(f.cache.get('membershipAuditCursor:'+shop),undefined);await assert.rejects(f.service.processMembershipAudit({shop:'invalid'}),/Invalid/);
});
