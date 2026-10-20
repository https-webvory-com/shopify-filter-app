import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCollectionPinnedPrefix} from '../../app/utils/collectionPinnedPrefix.js';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';
import {loadModule} from './helpers/search-ranking.mjs';
const merch=await loadModule('app/services/merchandising.server.js',{'../db.server.js':{default:{}}});
function fixture(){
 const shop='fixture.myshopify.com',docs=Array.from({length:60},(_,i)=>({id:String(i+1),shop,status:'ACTIVE',title:'Dress '+i,handle:'dress-'+i,priceMin:100,tags:i%2?['Top']:[],images:['default.jpg'],variantPrices:[],options:[]}));
 const pins=[40,12,50,9,30,15].map(id=>({id:'gid://shopify/Product/'+id,image:'pin-'+id+'.jpg'}));let batches=0,searches=0;
 const spec={shop,retainForIdle:true,needsShopifyOrder:true,sortBy:'best-selling',orderedIds:docs.map(p=>p.id),pinnedIds:pins.map(p=>p.id),pinningRule:{products:pins},query:{q:'',filter:['tenant']},rule:{conditions:[{action:'Exclude',field:'Tags',value:'Top'},{action:'Dynamic',field:'Tags',value:'Top',operator:'Set',operand:'999999'}]},globalSettings:{},mergedValues:[]};
 const index={getDocuments:async options=>{batches++;const ids=JSON.parse(options.filter.slice(6));return {results:docs.filter(p=>ids.includes(p.id)),total:ids.length};},search:async(_q,options)=>{searches++;return {hits:docs.slice(options.offset,options.offset+options.limit),estimatedTotalHits:docs.length};}};
 const deps={index,prisma:{},arrange:merch.applyMerchandisingRules,comparator:merch.createMerchandisingComparator};
 return {shop,docs,pins,spec,index,deps,counts:()=>({batches,searches})};
}
test('cold pin prefix equals the canonical leading cards and images without scanning the collection',async()=>{
 const f=fixture(),prefix=await prepareCollectionPinnedPrefix(f.spec,f.deps);
 assert.deepEqual(f.counts(),{batches:1,searches:0});assert.equal(prefix.ids.length,6);
 const full=await prepareCollectionRanking(f.spec,f.deps);assert.deepEqual(prefix.ids,full.ids.slice(0,6));
 for(const id of prefix.ids)assert.deepEqual(prefix.metadata[id],full.metadata[id]);
 assert.equal(prefix.metadata['40'].merchandisingImage,'pin-40.jpg');
});
test('prefix proof declines free, missing-price, inactive, cross-tenant and incomplete product documents',async()=>{
 for(const mutation of [p=>p.priceMin=0,p=>delete p.priceMin,p=>p.priceMin='',p=>p.priceMin='bad',p=>p.status='DRAFT',p=>p.shop='other.myshopify.com',p=>delete p.shop,p=>delete p.title,p=>delete p.handle]){
  const f=fixture();mutation(f.docs.find(p=>p.id==='40'));
  try{assert.equal(await prepareCollectionPinnedPrefix(f.spec,f.deps),null);}catch(error){assert.match(error.message,/eligibility|tenant/);}
 }
});
test('only eligible configured pins in original order can establish a prefix',async()=>{
 const f=fixture();f.spec.pinnedIds=f.spec.pinnedIds.slice(1);
 const prefix=await prepareCollectionPinnedPrefix(f.spec,f.deps);assert.deepEqual(prefix.ids,['12','50','9','30','15']);
 for(const mutate of [s=>s.pinningRule.products.push(s.pinningRule.products[0]),s=>s.pinnedIds=[],s=>s.sortBy='price-ascending',s=>s.retainForIdle=false,s=>s.needsShopifyOrder=false,s=>s.pinningRule.products='bad']){
  const other=fixture();mutate(other.spec);assert.equal(await prepareCollectionPinnedPrefix(other.spec,other.deps),null);
 }
});

test('pin counts around page boundaries preserve exactly the canonical first page',async()=>{
 for(const count of [1,24,25,26,40,50,51]){
  const f=fixture();f.spec.pinningRule.products=f.docs.slice(0,count).map(p=>({id:'gid://shopify/Product/'+p.id}));
  f.spec.pinnedIds=f.spec.pinningRule.products.map(p=>p.id);
  const prefix=await prepareCollectionPinnedPrefix(f.spec,f.deps),full=await prepareCollectionRanking(f.spec,f.deps);
  assert.equal(prefix.ids.length,Math.min(25,count));assert.deepEqual(prefix.ids,full.ids.slice(0,Math.min(25,count)));
 }
 const f=fixture();f.spec.pinningRule.products=f.docs.slice(0,40).map(p=>({id:'gid://shopify/Product/'+p.id}));f.spec.pinnedIds=f.spec.pinningRule.products.map(p=>p.id);
 f.docs[25].priceMin=0;
 const prefix=await prepareCollectionPinnedPrefix(f.spec,f.deps),full=await prepareCollectionRanking(f.spec,f.deps);
 assert.deepEqual(prefix.ids,full.ids.slice(0,25));
});
