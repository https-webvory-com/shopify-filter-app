import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCollectionReuse} from '../../app/utils/validateCollectionReuse.js';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';
const spec={needsShopifyOrder:true,sortBy:'best-selling',orderedIds:['1','2'],query:{q:'',filter:["shop = 'fixture'","available = true"],sort:['bestSellingScore:desc'],limit:25,attributesToRetrieve:['variantPrices']}};

test('native Shopify orders reuse without a search but unsupported sort/base orders fail closed',async()=>{
 const index={search:()=>assert.fail('Unexpected search')};
 assert.equal(await validateCollectionReuse(index,spec,{ids:['2','1']}),true);
 assert.equal(await validateCollectionReuse(index,{...spec,sortBy:'price-ascending'},{ids:['2','1']}),false);
 assert.equal(await validateCollectionReuse(index,{...spec,orderedIds:null},{ids:['2','1']}),false);
});
test('outside Include base order is revalidated independently of final merchandising order',async()=>{
 let hits=[{id:'x'},{id:'y'}],query;
 const index={search:async(_q,options)=>{query=options;return {hits};}};
 const saved={ids:['y','1','x'],sourceOutsideIds:['x','y']};
 assert.equal(await validateCollectionReuse(index,spec,saved),true);
 assert.deepEqual(query.sort,spec.query.sort);assert.deepEqual(query.filter.slice(0,2),spec.query.filter);
 assert.deepEqual(query.attributesToRetrieve,['id']);assert.equal(query.limit,3);
 hits.reverse();assert.equal(await validateCollectionReuse(index,spec,saved),false);
 hits=[{id:'x'}];assert.equal(await validateCollectionReuse(index,spec,saved),false);
});
test('legacy outside orders and excessive proofs rebuild while explicit placeholder pins remain stable',async()=>{
 const index={search:()=>assert.fail('Unexpected search')};
 assert.equal(await validateCollectionReuse(index,spec,{ids:['x','1']}),false);
 assert.equal(await validateCollectionReuse(index,spec,{ids:['x'],sourceOutsideIds:Array.from({length:1001},(_,i)=>String(i))}),false);
 assert.equal(await validateCollectionReuse(index,{...spec,pinnedIds:['x']},{ids:['x','1'],sourceOutsideIds:[]}),true);
});

test('verified event-driven public rankings reuse their versioned order without repeating outside-order scans',async()=>{
 const index={search:()=>assert.fail('Unexpected rescan')};
 const saved={ids:['x','1'],sourceOutsideIds:Array.from({length:2000},(_,i)=>String(i)),rankingEventsVersion:1};
 assert.equal(await validateCollectionReuse(index,{...spec,retainForIdle:true},saved),true);
 assert.equal(await validateCollectionReuse(index,{...spec,retainForIdle:true,needsShopifyOrder:false,sortBy:'price-ascending'},saved),true);
 assert.equal(await validateCollectionReuse(index,{...spec,retainForIdle:false,needsShopifyOrder:false},saved),false);
});
test('the ranker captures outside base IDs before merchandising and excludes fixed placeholder pins',async()=>{
 const docs=['x','1','y','2'].map(id=>({id,priceMin:10}));
 const result=await prepareCollectionRanking({...spec,shop:'fixture',rule:{conditions:[]},pinnedIds:['pin']},{
  captureReuse:true,prisma:{product:{findMany:async()=>[{id:'gid://shopify/Product/pin',priceMin:10}]}},index:{search:async(_q,o)=>({hits:docs.slice(o.offset,o.offset+o.limit),estimatedTotalHits:4})},
  arrange:products=>products,comparator:()=>((a,b)=>a._originalIndex-b._originalIndex),
 });
 assert.deepEqual(result.ids,['1','2','x','y','pin']);assert.deepEqual(result.sourceOutsideIds,['x','y']);
});
