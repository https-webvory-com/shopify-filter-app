import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';
const ctx={module:{exports:{}},exports:{},console:{error(){}},require:()=>({__esModule:true,default:{}})};
vm.runInNewContext((await transform(await fs.readFile('app/services/merchandising.server.js','utf8'),{format:'cjs'})).code,ctx);
const {applyMerchandisingRules:arrange,createMerchandisingComparator:comparator}=ctx.module.exports;

test('bounded-batch preparation matches complete ranking IDs and metadata across rules, pins and sorts',async()=>{
  const docs=Array.from({length:2250},(_,i)=>({id:String(i+1),title:'Product '+String(2250-i).padStart(5,'0'),vendor:i%2?'A':'B',tags:[i%3?'boost':'bury',i%5?'ordinary':'pinned'],priceMin:i%17===0?0:i%20,inventoryTotal:i%23===0?0:5,createdAt:1700000000000+i*86400000,bestSellingScore:i%31,trendingScore:i%37,options:[{name:'Color',values:['Blue','Red']}],images:['gallery.jpg'],variantPrices:[{id:String(i*100),option1:i%2?'Blue':'Red',available:true,price:20,compareAtPrice:30,imageUrl:'variant-'+i+'.jpg',sku:'sku-'+i}]}));
  const index={search:async(_q,options)=>({hits:docs.slice(options.offset,options.offset+options.limit).map(doc=>Object.fromEntries(options.attributesToRetrieve.filter(key=>key in doc).map(key=>[key,doc[key]]))),estimatedTotalHits:docs.length})};
  const prisma={product:{findMany:async()=>[{id:'gid://shopify/Product/9999',priceMin:0}]},variant:{findMany:async()=>[],groupBy:async()=>[]}};
  const ruleSets=[[],[{field:'Tags',action:'Boost',value:'boost'},{field:'Tags',action:'Bury',value:'bury'}],[{field:'Tags',action:'Pin',value:'pinned'},{field:'Tags',action:'Dynamic',value:'pinned',operator:'Set',operand:'0'}],[{field:'Color',action:'Boost',value:'Blue'},{field:'Available',action:'Exclude',minValue:0,maxValue:0}],[{field:'SKU',action:'Exclude',value:'sku-2000'},{field:'Price',action:'Boost',minValue:5,maxValue:10},{field:'Vendor',action:'Dynamic',value:'A',operator:'Multiply',operand:'2'}]];
  let comparisons=0;
  for(const needsShopifyOrder of [true,false])for(const sortBy of ['best-selling','price-ascending','price-descending','title-ascending','created-descending','trending'])for(const flags of [[false,false],[true,false],[false,true],[true,true]])for(const conditions of ruleSets){
    const spec={shop:'fixture.myshopify.com',query:{q:'',filter:[]},sortBy,needsShopifyOrder,orderedIds:needsShopifyOrder?docs.map(p=>p.id).reverse().filter(id=>id!=='1003'):null,pinnedIds:['gid://shopify/Product/2200','gid://shopify/Product/1','gid://shopify/Product/9999'],pinningRule:{products:JSON.stringify([{id:'gid://shopify/Product/2200',image:'manual-pin.jpg'},{id:'gid://shopify/Product/1'},{id:'gid://shopify/Product/9999'}])},rule:{conditions},mergedValues:[],globalSettings:{prioritizeSortOverPinning:flags[0],prioritizeSortOverMerchandising:flags[1]}};
    const baseline=await prepareCollectionRanking(spec,{index,prisma,arrange});
    const streamed=await prepareCollectionRanking(spec,{index,prisma,arrange,comparator});
    assert.deepEqual(streamed,baseline,JSON.stringify({sortBy,needsShopifyOrder,flags,conditions}));comparisons++;
  }
  assert.equal(comparisons,240);
});

test('streamed scan still rejects duplicate IDs and partial results and preserves empty collections',async()=>{
  const spec={shop:'fixture.myshopify.com',query:{q:'',filter:[]},sortBy:'best-selling',orderedIds:[],pinnedIds:[],rule:{conditions:[]}};
  const deps={prisma:{},arrange,comparator};
  assert.deepEqual(await prepareCollectionRanking(spec,{...deps,index:{search:async()=>({hits:[],estimatedTotalHits:0})}}),{ids:[],metadata:{}});
  await assert.rejects(prepareCollectionRanking(spec,{...deps,index:{search:async()=>({hits:[{id:'1'},{id:'1'}]})}}),/changed/);
  await assert.rejects(prepareCollectionRanking(spec,{...deps,index:{search:async()=>({hits:[{id:'1'}],estimatedTotalHits:2})}}),/Incomplete/);
});

test('malformed legacy pin data has the same behavior in either preparation path',async()=>{
  for(const products of ['{bad','{}','null']){
    const spec={shop:'fixture.myshopify.com',query:{q:'',filter:[]},sortBy:'best-selling',orderedIds:['1'],pinnedIds:[],rule:{conditions:[]},pinningRule:{products}};
    const index={search:async()=>({hits:[{id:'1',priceMin:10}],estimatedTotalHits:1})};
    assert.deepEqual(await prepareCollectionRanking(spec,{index,prisma:{},arrange,comparator}),await prepareCollectionRanking(spec,{index,prisma:{},arrange}));
  }
});

test('a queued ranking batch supplies an abortable request to the search engine',async()=>{
  let signal;
  await prepareCollectionRanking({shop:'fixture.myshopify.com',query:{q:'',filter:[]},sortBy:'best-selling',orderedIds:[],pinnedIds:[],rule:{conditions:[]}},{prisma:{},arrange,comparator,index:{search:async(_q,_params,request)=>{signal=request.signal;return {hits:[],estimatedTotalHits:0};}}});
  assert.ok(signal instanceof AbortSignal);assert.equal(signal.aborted,false);
});
