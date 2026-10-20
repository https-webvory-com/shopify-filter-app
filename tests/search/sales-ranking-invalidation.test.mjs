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
  require:name=>({__esModule:true,default:name==='../db.server.js'?{product:{findMany:async()=>products},productCollection:{findMany:async({where})=>{calls.push(['scope',where.product.shop,where.productId?.in]);return [{collectionId:'gid://shopify/Collection/1'}];}}}:name==='./meiliClient.server.js'?{
   index:()=>({updateDocuments:async docs=>{calls.push(['write',docs.length]);return {taskUid:calls.length};}}),
   tasks:{waitForTask:async id=>{calls.push(['wait',id]);if(!pending){pending=true;await new Promise(resolve=>release=resolve);}return {status:failed||partial&&id===2?'failed':'succeeded'};}},
  }: {}}),
 };
 vm.runInNewContext(compiled,context);
 return {calls,run:()=>context.module.exports.pushScoresToMeili('fixture.myshopify.com',['gid://shopify/Product/1']),release:()=>release?.()};
}

test('incremental score writes select only changed products and send exact external dependency proof',async()=>{
 const writes=[],invalidations=[],queries=[],shop='fixture.myshopify.com';
 const products=[{id:'gid://shopify/Product/1',tags:['TopProm'],bestSellingScore:3,trendingScore:4}];
 const ctx={module:{exports:{}},exports:{},console:{log(){},error(){}},fixtureInvalidate:async(_shop,options)=>invalidations.push(options),require:name=>({__esModule:true,default:name==='../db.server.js'?{
  product:{findMany:async options=>{queries.push(options);return products;}},productCollection:{findMany:async()=>[]},
 }:name==='./meiliClient.server.js'?{index:()=>({updateDocuments:async docs=>{writes.push(docs);return {taskUid:1};},getDocuments:async()=>({results:[{id:'1',shop,tags:['TopProm']}]})}),tasks:{waitForTask:async()=>({status:'succeeded'})}}:{}})};
 vm.runInNewContext(compiled,ctx);await ctx.module.exports.pushScoresToMeili(shop,['gid://shopify/Product/1']);
 assert.deepEqual(Array.from(queries[0].where.id.in),['gid://shopify/Product/1']);assert.equal(writes[0].length,1);
 assert.deepEqual(Array.from(invalidations[0].externalProof.tags),['TopProm']);assert.deepEqual(Array.from(invalidations[0].externalProof.ids),['1']);
});
test('sales score changes invalidate ranking versions only after every index batch becomes visible',async()=>{
 const f=fixture(),work=f.run();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.calls.some(c=>c[0]==='invalidate'),false);f.release();await work;
 assert.deepEqual(f.calls.map(c=>c[0]),['write','write','wait','wait','scope','invalidate']);
 assert.deepEqual(f.calls.at(-1),['invalidate','fixture.myshopify.com','products','gid://shopify/Collection/1']);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-2))),['scope','fixture.myshopify.com',['gid://shopify/Product/1']]);
});
test('failed score indexing cannot publish a successful ranking invalidation event',async()=>{
 const f=fixture({failed:true}),work=f.run();await new Promise(resolve=>setImmediate(resolve));f.release();await work;
 assert.equal(f.calls.some(c=>c[0]==='invalidate'),false);assert.equal(f.calls.some(c=>c[0]==='error'),true);
});

test('partially successful sales-score writes still invalidate the ranking inputs that changed',async()=>{
 const f=fixture({partial:true}),work=f.run();await new Promise(resolve=>setImmediate(resolve));f.release();await work;
 assert.equal(f.calls.filter(c=>c[0]==='invalidate').length,1);assert.equal(f.calls.some(c=>c[0]==='error'),true);
});
