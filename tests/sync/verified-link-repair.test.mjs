import test from 'node:test';import assert from 'node:assert/strict';import {repairVerifiedCollectionLinks} from '../../scripts/repair-verified-collection-links.mjs';
const shop='fixture.myshopify.com',pid='gid://shopify/Product/1',cid='gid://shopify/Collection/2';
function fixture({canonical=true,owner=shop,taskStatus='succeeded'}={}){
 const events=[],links=new Set(['original']),doc={id:'1',shop,collections:['original'],collection_titles:['Original'],priceMin:100,available:true,variantPrices:[{price:100,available:true}]};
 const product={findFirst:async({where})=>where.shop===shop?{id:pid,updatedAt:'fixed'}:null},productCollection={findUnique:async()=>links.has(cid)?{productId:pid,collectionId:cid}:null,createMany:async()=>{events.push('db');links.add(cid);}};
 const db={product,productCollection,collection:{findUnique:async()=>({id:cid,title:'New',shop:owner})},$transaction:async fn=>fn({product,productCollection})};
 const index={getDocument:async()=>structuredClone(doc),updateDocuments:async updates=>{events.push('index');Object.assign(doc,updates[0]);return{taskUid:1};}};
 const options={db,index,tasks:{waitForTask:async()=>({status:taskStatus})},shop,targets:[{productId:pid,collectionId:cid}],readCanonical:async()=>({id:pid,status:'ACTIVE',publishedAt:'x',inCollection:canonical}),backup:async()=>events.push('backup')};
 return{run:apply=>repairVerifiedCollectionLinks({...options,apply}),events,doc,links};
}
test('verified link repair defaults to validation without mutations',async()=>{const f=fixture();assert.equal((await f.run(false)).validated,1);assert.deepEqual(f.events,[]);});
test('repair backs up before narrow writes and preserves stock price and other links',async()=>{const f=fixture();const out=await f.run(true);assert.deepEqual(f.events,['backup','db','index']);assert.equal(out.verified,1);assert.ok(f.links.has('original'));assert.equal(f.doc.priceMin,100);assert.deepEqual(f.doc.variantPrices,[{price:100,available:true}]);assert.deepEqual(f.doc.collections,['original',cid]);assert.equal((await f.run(true)).verified,1);});
test('changed canonical membership and wrong-shop scope stop before any writes',async()=>{for(const options of [{canonical:false},{owner:'other.myshopify.com'}]){const f=fixture(options);await assert.rejects(f.run(true));assert.deepEqual(f.events,[]);}});
test('failed index tasks cannot report verified repair',async()=>{const f=fixture({taskStatus:'failed'});await assert.rejects(f.run(true),/indexing failed/);assert.equal(f.events[0],'backup');});
