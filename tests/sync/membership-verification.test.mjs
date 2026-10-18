import test from 'node:test';import assert from 'node:assert/strict';
import {verifyMembershipWrites} from '../../app/services/productCollections.server.js';
import {readCanonicalCollectionMembers,reconcileCollectionMembership} from '../../app/utils/reconcileCollectionMembership.js';
const shop='fixture.myshopify.com',cid='gid://shopify/Collection/1',pid='gid://shopify/Product/1';
const reply=(nodes,hasNextPage=false,endCursor=null,total=nodes.length)=>({json:async()=>({data:{collection:{id:cid,productsCount:{count:total},products:{nodes,pageInfo:{hasNextPage,endCursor}}}}})});
const product={id:pid,status:'ACTIVE',publishedAt:'2026-10-18'};
test('membership reads complete every page and ignore unpublished or inactive products',async()=>{
 let calls=0;const ids=await readCanonicalCollectionMembers({graphql:async()=>++calls===1?reply([product,{id:'gid://shopify/Product/2',status:'DRAFT',publishedAt:'x'}],true,'next',3):reply([{id:'gid://shopify/Product/3',status:'ACTIVE',publishedAt:null}],false,null,3)},cid);
 assert.deepEqual([...ids],[pid]);assert.equal(calls,2);
});
test('failed or looping source pagination cannot trigger repairs',async()=>{
 for(const graphql of [async()=>({json:async()=>({errors:[{}]})}),async()=>reply([product],true,'same')])await assert.rejects(readCanonicalCollectionMembers({graphql},cid));
});
test('an early final page cannot prove a complete collection snapshot',async()=>{
 await assert.rejects(readCanonicalCollectionMembers({graphql:async()=>reply([product],false,null,20)},cid),/Incomplete/);
});
function fixture({dbHas=false,indexHas=false,fail=false,owner=shop}={}){let stored=dbHas,indexed=indexHas,writes=0;
 const db={collection:{findUnique:async()=>({shop:owner})},productCollection:{findMany:async({where})=>{assert.equal(where.product.shop,shop);return stored?[{productId:pid}]:[];}}};
 const index={search:async()=>({hits:indexed?[{id:'1',shop}]:[],totalHits:indexed?1:0})};
 return{run:()=>reconcileCollectionMembership({db,index,shop,collectionId:cid,admin:{graphql:async()=>reply([product])},syncProduct:async id=>{assert.equal(id,pid);writes++;if(fail)throw Error('index failed');stored=indexed=true;}}),writes:()=>writes};}
test('DB-only and index-only gaps are repaired and both systems reverified',async()=>{for(const state of [{dbHas:true},{indexHas:true},{}]){const f=fixture(state);assert.deepEqual(await f.run(),{verified:true,products:1,repaired:1});assert.equal(f.writes(),1);}});
test('already consistent membership is a read-only no-op',async()=>{const f=fixture({dbHas:true,indexHas:true});assert.equal((await f.run()).repaired,0);assert.equal(f.writes(),0);});
test('failed writes and cross-shop scope never report successful verification',async()=>{await assert.rejects(fixture({fail:true}).run(),/index failed/);const f=fixture({owner:'other.myshopify.com'});await assert.rejects(f.run(),/ownership/);assert.equal(f.writes(),0);});
test('batch verification rejects missing DB links or missing indexed memberships',async()=>{
 const p={id:pid,collections:{nodes:[{id:cid}]}},doc={id:'1',collections:[cid]};
 for(const[dbLinks,indexLinks]of [[[],[cid]],[[cid],[]]])await assert.rejects(verifyMembershipWrites({product:{findMany:async()=>[{id:pid,collections:dbLinks.map(collectionId=>({collectionId}))}]}},{search:async()=>({hits:[{id:'1',shop,collections:indexLinks}]})},shop,[p],[doc]),/verification failed/);
});
test('batch verification accepts complete DB links with deliberately published-only index scope',async()=>{
 await verifyMembershipWrites({product:{findMany:async()=>[{id:pid,collections:[{collectionId:cid},{collectionId:'unpublished'}]}]}},{search:async()=>({hits:[{id:'1',shop,collections:[cid]}]})},shop,[{id:pid,collections:{nodes:[{id:cid},{id:'unpublished'}]}}],[{id:'1',collections:[cid]}]);
});
