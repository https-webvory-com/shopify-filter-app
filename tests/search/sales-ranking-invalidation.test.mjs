import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';

const source=(await fs.readFile('app/services/orders.server.js','utf8')).replace("await import('./shopCache.server.js')",'({invalidateShop:fixtureInvalidate})');
const compiled=(await transform(source,{format:'cjs'})).code;
function fixture({failed=false,partial=false}={}){
 const calls=[],products=Array.from({length:1501},(_,i)=>({id:'gid://shopify/Product/'+i,bestSellingScore:i,trendingScore:i}));let pending,release;
 const context={module:{exports:{}},exports:{},console:{log(){},error:(...args)=>calls.push(['error',...args])},
  fixtureInvalidate:async(shop,options)=>calls.push(['invalidate',shop,options.kind,...options.collectionIds]),
  require:name=>({__esModule:true,default:name==='../db.server.js'?{product:{findMany:async options=>{calls.push(['page',options.take,options.cursor?.id]);const start=options.cursor?products.findIndex(p=>p.id===options.cursor.id)+1:0;return products.slice(start,start+options.take);}},$queryRaw:async(strings,...parameters)=>{assert.match(strings.join('?'),/SELECT DISTINCT pc\."collectionId"/);assert.match(strings.join('?'),/p\.shop=/);calls.push(['scope',parameters[0],parameters[1]]);return [{collectionId:'gid://shopify/Collection/1'}];},productCollection:{findMany:async()=>{throw Error('Full membership materialization is not allowed');}}}:name==='./meiliClient.server.js'?{
   index:()=>({updateDocuments:async docs=>{calls.push(['write',docs.length]);return {taskUid:calls.length};}}),
   tasks:{waitForTask:async id=>{calls.push(['wait',id]);if(!pending){pending=true;await new Promise(resolve=>release=resolve);}return {status:failed||partial&&id===2?'failed':'succeeded'};}},
  }: {}}),
 };
 vm.runInNewContext(compiled,context);
 return {calls,run:()=>context.module.exports.pushScoresToMeili('fixture.myshopify.com'),release:()=>release?.()};
}

test('incremental score writes select only changed products and send exact external dependency proof',async()=>{
 const writes=[],invalidations=[],queries=[],shop='fixture.myshopify.com';
 const products=[{id:'gid://shopify/Product/1',tags:['TopProm'],bestSellingScore:3,trendingScore:4}];
 const ctx={module:{exports:{}},exports:{},console:{log(){},error(){}},fixtureInvalidate:async(_shop,options)=>invalidations.push(options),require:name=>({__esModule:true,default:name==='../db.server.js'?{
  product:{findMany:async options=>{queries.push(options);return products;}},$queryRaw:async(strings,...parameters)=>{assert.equal(parameters[0],shop);assert.deepEqual(Array.from(parameters[1]),['gid://shopify/Product/1']);assert.match(strings.join('?'),/pc\."productId"=ANY\(/);return [];},productCollection:{findMany:async()=>{throw Error('Full membership materialization is not allowed');}},
 }:name==='./meiliClient.server.js'?{index:()=>({updateDocuments:async docs=>{writes.push(docs);return {taskUid:1};},getDocuments:async()=>({results:[{id:'1',shop,tags:['TopProm']}]})}),tasks:{waitForTask:async()=>({status:'succeeded'})}}:{}})};
 vm.runInNewContext(compiled,ctx);await ctx.module.exports.pushScoresToMeili(shop,['gid://shopify/Product/1']);
 assert.deepEqual(Array.from(queries[0].where.id.in),['gid://shopify/Product/1']);assert.equal(writes[0].length,1);
 assert.deepEqual(Array.from(invalidations[0].externalProof.tags),['TopProm']);assert.deepEqual(Array.from(invalidations[0].externalProof.ids),['1']);
});
test('sales score changes invalidate ranking versions only after every index batch becomes visible',async()=>{
 const f=fixture(),work=f.run();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.some(c=>c[0]==='invalidate'),false);f.release();await work;
 assert.deepEqual(f.calls.map(c=>c[0]),['page','write','page','write','wait','wait','scope','invalidate']);
 assert.deepEqual(f.calls.filter(c=>c[0]==='page'),[['page',1000,undefined],['page',1000,'gid://shopify/Product/999']]);
 assert.deepEqual(f.calls.at(-1),['invalidate','fixture.myshopify.com','scores','gid://shopify/Collection/1']);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-2))),['scope','fixture.myshopify.com',null]);
});
test('failed score indexing cannot publish a successful ranking invalidation event',async()=>{
 const f=fixture({failed:true}),work=f.run();await new Promise(resolve=>setImmediate(resolve));f.release();await assert.rejects(work,/Some sales-score indexing tasks failed/);
 assert.equal(f.calls.some(c=>c[0]==='invalidate'),false);assert.equal(f.calls.some(c=>c[0]==='error'),true);
});

test('partially successful sales-score writes still invalidate the ranking inputs that changed',async()=>{
 const f=fixture({partial:true}),work=f.run();await new Promise(resolve=>setImmediate(resolve));f.release();await assert.rejects(work,/Some sales-score indexing tasks failed/);
 assert.equal(f.calls.filter(c=>c[0]==='invalidate').length,1);assert.equal(f.calls.some(c=>c[0]==='error'),true);
});
