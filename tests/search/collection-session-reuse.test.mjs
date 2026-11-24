import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {transform} from 'esbuild';
import * as keys from '../../app/utils/shopCacheInvalidation.js';
import * as sales from '../../app/utils/collectionSalesDependencies.js';
import {createLoadingServer} from '../collection-loading/server.mjs';

async function proofFixture(){
 const values=new Map(),redis={get:async key=>values.get(key),mget:async(...keys)=>keys.map(key=>values.get(key))};
 const context={module:{exports:{}},exports:{},require:name=>name==='node:crypto'?crypto:name.includes('redis.server')?{__esModule:true,default:redis}:name.includes('shopCacheInvalidation')?keys:sales};
 vm.runInNewContext((await transform(await fs.readFile('app/services/collectionFilterMembership.server.js','utf8'),{format:'cjs'})).code,context);
 return {values,proof:context.module.exports.collectionMembershipProof};
}

test('native session freezes order across product updates but keeps rule, shop, market and configuration boundaries',async()=>{
 const {values,proof}=await proofFixture(),input={shop:'fixture.myshopify.com',collectionId:'1',configuration:'0',marketVersion:'IN-v1',orderRevision:'native-1',rule:{conditions:[]},globalSettings:{showOnlyInStock:true}};
 const snapshot=await proof({...input,snapshot:true}),strict=await proof(input);
 assert.match(snapshot,/^snapshot-v1:[a-f0-9]{64}$/);
 values.set(keys.productRevisionKey(input.shop,'all'),'1');values.set(keys.productContentRevisionKey(input.shop,'1'),'2');
 assert.equal(await proof({...input,snapshot:true,orderRevision:'native-2'}),snapshot);
 assert.notEqual(await proof(input),strict);
 for(const change of [{shop:'other.myshopify.com'},{collectionId:'2'},{marketVersion:'US-v1'},{rule:{conditions:[{action:'Exclude',field:'Tags',value:'hidden'}]}},{globalSettings:{showOnlyInStock:false}}])assert.notEqual(await proof({...input,...change,snapshot:true}),snapshot);
 values.set(keys.configurationRevisionKey(input.shop),'1');assert.equal(await proof({...input,snapshot:true}),null);
});

test('browser retains the full collection for changed or removed categories and bounds its token history',async()=>{
 const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
 const block=source.slice(source.indexOf('  /* CFP_MEMBERSHIP_START */'),source.indexOf('  let pendingFilterScroll'));
 const context={URL,URLSearchParams};vm.createContext(context);
 vm.runInContext(block+'\nthis.remember=rememberCollectionMembership;this.parent=collectionMembershipParent;this.size=()=>collectionMembershipResults.size;',context);
 const base=new URLSearchParams('shop=s&country=IN&collectionHandle=one&sortBy=best-selling&page=1&limit=25');
 const params=(color,size)=>{const p=new URLSearchParams(base);if(color)p.set('options[Color][]',color);if(size)p.set('options[Size][]',size);return p;};
 context.remember(base,{rankingToken:'full'});context.remember(params('Blue'),{rankingToken:'blue',cfpCards:{version:2,preview:true,filtered:true}});
 assert.equal(context.parent(params('Blue','M')).token,'blue');
 context.remember(params('Blue','M'),{rankingToken:'blue-m'});
 assert.equal(context.parent(params('Red','M')).token,'full');
 assert.equal(context.parent(params('Blue')).token,'full');
 for(let i=0;i<20;i++)context.remember(params('Color'+i),{rankingToken:'color-'+i});
 assert.equal(context.size(),8);assert.equal(context.parent(params('Red','M')).token,'full');
 const other=params('Red');other.set('country','US');assert.equal(context.parent(other),undefined);
 const sorted=params('Red');sorted.set('sortBy','price-ascending');assert.equal(context.parent(sorted),undefined);
 context.remember(params('Preview'),{rankingToken:'preview',cfpCards:{preview:true}});
 assert.equal(context.parent(params('Preview','M')).token,'full');
 context.remember(params('Direct'),{rankingToken:'direct',cfpCards:{version:2,preview:true,filtered:true,directSort:{version:1}}});
 assert.equal(context.parent(params('Direct','M')).token,'full');
});

test('ready collection cards cancel obsolete facet work during successive selections without delaying cards',async()=>{
 const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
 const block=source.slice(source.indexOf('  async function scheduleCollectionFacets'),source.indexOf('  async function completeCollectionFacets'));
 let calls=0;const context={setTimeout,clearTimeout,filtersReady:true,cfpLastSettings:[{}],completeCollectionFacets:async()=>{calls++;}};
 vm.createContext(context);vm.runInContext(block,context);
 const controller=new AbortController(),pending=context.scheduleCollectionFacets({cfpCards:{filtered:true}},'url',controller.signal);
 assert.equal(calls,0);controller.abort();await pending;assert.equal(calls,0);
 await context.scheduleCollectionFacets({cfpCards:{}},'url',new AbortController().signal);assert.equal(calls,1);
 await context.scheduleCollectionFacets({cfpCards:{filtered:true}},'url',new AbortController().signal);assert.equal(calls,2);
});

test('filtering a complete prepared native collection reuses order without preparing ranking or waiting for order refresh',async()=>{
 const f=await createLoadingServer();
 try{
  Object.assign(f.state,{delay:0,membershipProof:'snapshot-v1:'+'a'.repeat(64),ruleConditions:[{action:'Boost',field:'Tags',operator:'contains',value:'product-2'},{action:'Exclude',field:'Id',value:'3'}]});
  for(const product of f.documents){
   const size=Number(product.id)%2?'M':'L';product.options.push({name:'Size',values:[size]});
   product.variantPrices.forEach(v=>{v.option2=size;v.marketPrices={US:{price:v.price,currency:'USD'}};});
  }
  // Product 5 has Blue and M, but on different variants. It may appear for
  // Blue alone and must disappear when M is selected as well.
  const split=f.documents.find(p=>p.id==='5'),first=split.variantPrices[0];
  split.options[0].values=['Blue','Red'];split.options[1].values=['L','M'];
  split.variantPrices=[{...first,option1:'Blue',option2:'L'},{...first,id:'501',option1:'Red',option2:'M'}];
  const base='http://fixture/api/filter?shop=headless-fixture.myshopify.com&country=US&locale=en&collectionHandle=fixture&sortBy=best-selling&page=1&limit=25&responseProfile=collection-v1';
  await f.load(new Request(base),{rankingWarmup:true,rankingPrecompute:true});
  const rootResponse=await f.load(new Request(base)),root=await rootResponse.json();
  assert.equal(rootResponse.status,200);assert.ok(root.rankingToken);
  const secondPage=new URL(base);secondPage.searchParams.set('page','2');secondPage.searchParams.set('rankingToken',root.rankingToken);
  const tail=await(await f.load(new Request(secondPage))).json(),allIds=[...root.products,...tail.products].map(p=>p.id);
  assert.equal(new Set(allIds).size,29);assert.equal(allIds.some(id=>id.split('/').pop()==='3'),false);
  const builds=f.state.builds;
  f.state.orderMissing=true;f.state.rankingFailure='throw';
  let parentUrl=base,parent=root;
  for(const [key,value]of [['options[Color][]','Blue'],['options[Size][]','M'],['vendor[]','Fixture'],['price[]','0:1000']]){
   const child=new URL(parentUrl);child.searchParams.set(key,value);child.searchParams.set('responseProfile','fast-cards-v1');
   child.searchParams.set('priceFilterVersion','1');child.searchParams.set('priceCurrency','USD');child.searchParams.set('priceSortRate','1');
   const prior=new URL(parentUrl);prior.searchParams.delete('membershipParentQuery');prior.searchParams.delete('membershipParentToken');
   child.searchParams.set('membershipParentToken',parent.rankingToken);child.searchParams.set('membershipParentQuery',prior.searchParams.toString());
   const response=await f.load(new Request(child)),body=await response.json();
   assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.debug.membershipReuse,'reused');assert.equal(body.debug.rankingPreparationMs,0);
   const expected=key==='options[Color][]'?allIds:allIds.filter(id=>Number(id.split('/').pop())%2&&id.split('/').pop()!=='5');
   assert.equal(body.totalCount,expected.length);assert.deepEqual(body.products.map(p=>p.id),expected.slice(0,25));
   assert.equal(f.state.builds,builds);parent=body;parentUrl=child.href;
  }
 }finally{f.dispose();}
});
