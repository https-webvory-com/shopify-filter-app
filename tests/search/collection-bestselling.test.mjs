import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import {readCollectionBestSellingIds} from '../../app/utils/collectionBestSelling.js';
import {fetchCollectionPage} from '../../app/utils/collectionPage.js';
test('Shopify order follows every collection page and explicitly requests BEST_SELLING',async()=>{
 const cursors=[];const admin={graphql:async(query,{variables})=>{assert.match(query,/sortKey: BEST_SELLING/);cursors.push(variables.cursor);return {json:async()=>({data:{collection:{products:{nodes:[{id:'gid://shopify/Product/'+(variables.cursor?'2':'1')}],pageInfo:{hasNextPage:!variables.cursor,endCursor:'next'}}}}})};}};
 assert.deepEqual(await readCollectionBestSellingIds(admin,'gid://shopify/Collection/1'),['1','2']);assert.deepEqual(cursors,[null,'next']);
});
test('an incomplete Shopify snapshot is rejected instead of truncating collection access',async()=>{
 await assert.rejects(readCollectionBestSellingIds({graphql:async()=>({json:async()=>({data:{collection:{products:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'same'}}}}})})},'collection'),/Incomplete/);
});
const context={module:{exports:{}},exports:{},console,require:()=>({__esModule:true,default:{}})};
vm.runInNewContext((await transform(await fs.readFile('app/services/merchandising.server.js','utf8'),{format:'cjs'})).code,context);
const apply=context.module.exports.applyMerchandisingRules;
test('pins, price boosts, and remaining products preserve the observed Shopify collection sequence across pages',async()=>{
 // Shopify positions 1-19 after unpublished products are excluded.
 const prices=[2450,1025,2111,2000,1000,2000,2000,2000,1000,629.95,2629.95,785.95,729.95,629.95,949.95,885.95,699.95,2629.95,885.95];
 const docs=prices.map((price,i)=>({id:String(i+1),priceMin:price,title:'Product '+(i+1),bestSellingScore:100-i,variants:[]})).reverse();
 const pins=['1','13'];const boosted=docs.filter(p=>p.priceMin>=1&&p.priceMin<=1000);
 const index={search:async(_q,opts)=>{const list=opts.filter.includes('boosted')?boosted:docs.filter(p=>!boosted.includes(p));return {hits:list.slice(opts.offset,opts.offset+opts.limit)};},getDocument:async id=>docs.find(p=>p.id===id)};
 const tiers=[{query:{q:'',filter:['boosted']},total:boosted.length},{query:{q:'',filter:['ordinary']},total:docs.length-boosted.length}];
 const output=[];
 for(let page=1;page<=4;page++){
  const result=await fetchCollectionPage(index,{page,limit:5,pinnedIds:pins,tiers,attributes:['id'],orderedIds:prices.map((_,i)=>String(i+1))});
  assert.equal(result.total,19);
  const products=result.hits.map((p,i)=>({...p,id:'gid://shopify/Product/'+p.id,_originalIndex:i}));
  const arranged=apply(products,{conditions:[{action:'Boost',field:'Price',minValue:'1',maxValue:'1000'}]},'best-selling',{products:pins.map(id=>({id:'gid://shopify/Product/'+id}))},[],{preserveCollectionBestSellingOrder:true});
  output.push(...arranged.map(p=>p.id.split('/').pop()));
 }
 assert.deepEqual(output,['1','13','5','9','10','12','14','15','16','17','19','2','3','4','6','7','8','11','18']);
 assert.equal(new Set(output).size,19);
});
test('Shopify ranking does not admit products outside the filtered collection or drop new unranked products',async()=>{
 const docs=[{id:'3'},{id:'2'},{id:'1'}];const index={search:async()=>({hits:docs}),getDocument:async id=>docs.find(p=>p.id===id)};
 const result=await fetchCollectionPage(index,{page:1,limit:25,pinnedIds:[],tiers:[{query:{q:'',filter:[]},total:3}],attributes:['id'],orderedIds:['99','1','2']});
 assert.deepEqual(result.hits.map(p=>p.id),['1','2','3']);assert.equal(result.total,3);
});

test('slow Shopify order loading yields quickly and reuses the same background refresh',async()=>{
 let finish;const gate=new Promise(resolve=>{finish=resolve;});let reads=0;
 const mocks={
  '../shopify.server.js':{unauthenticated:{admin:async()=>({admin:{}})}},
  './shopCache.server.js':{getCached:async(_key,read)=>read()},
  '../utils/collectionBestSelling.js':{readCollectionBestSellingIds:async()=>{reads++;await gate;return ['1','2'];}},
 };
 const ctx={module:{exports:{}},exports:{},setTimeout,clearTimeout,console:{error(){}},require:name=>mocks[name]};
 vm.runInNewContext((await transform(await fs.readFile('app/services/collectionBestSelling.server.js','utf8'),{format:'cjs'})).code,ctx);
 const get=ctx.module.exports.getCollectionBestSellingIds;
 assert.equal(await get('shop','collection',1),null);
 const warmed=get('shop','collection',100);finish();
 assert.deepEqual(Array.from(await warmed),['1','2']);assert.equal(reads,1);
});
test('Shopify authentication failure returns the existing rendering fallback',async()=>{
 const mocks={
  '../shopify.server.js':{unauthenticated:{admin:async()=>{throw Error('401 Unauthorized');}}},
  './shopCache.server.js':{getCached:async(_key,read)=>read()},
  '../utils/collectionBestSelling.js':{},
 };
 const ctx={module:{exports:{}},exports:{},setTimeout,clearTimeout,console:{error(){}},require:name=>mocks[name]};
 vm.runInNewContext((await transform(await fs.readFile('app/services/collectionBestSelling.server.js','utf8'),{format:'cjs'})).code,ctx);
 assert.equal(await ctx.module.exports.getCollectionBestSellingIds('shop','collection'),null);
});
