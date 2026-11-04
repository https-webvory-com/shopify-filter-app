import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCollectionRanking } from '../../app/utils/prepareCollectionRanking.js';

test('partial India prices sort priced products first and keep missing products visible',async()=>{
  const docs=[
    {id:'1',priceMin:20,marketAvailablePriceMin_IN:2600},
    {id:'2',priceMin:10},
    {id:'3',priceMin:30,marketAvailablePriceMin_IN:2000},
    {id:'4',priceMin:40,marketAvailablePriceMin_IN:null},
  ];
  const index={search:async(_q,options)=>({hits:docs.slice(options.offset,options.offset+options.limit),totalHits:docs.length})};
  for(const [sortBy,expected] of [['price-ascending',['3','1','2','4']],['price-descending',['1','3','4','2']]]){
    const spec={shop:'fixture.myshopify.com',sortBy,priceSortField:'marketAvailablePriceMin_IN',allowIncompleteMarketPrice:true,
      query:{indexUid:'products',q:'',filter:[]},pinnedIds:[],globalSettings:{prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true}};
    const result=await prepareCollectionRanking(spec,{index,prisma:{},arrange:products=>products,
      comparator:()=>sortBy==='price-ascending'?(a,b)=>a.priceMin-b.priceMin:(a,b)=>b.priceMin-a.priceMin});
    assert.deepEqual(result.ids,expected);
  }
});

test('complete market price ranking orders the full ID list without changing storefront base prices',async()=>{
  const docs=[
    {id:'1',title:'First',priceMin:20,marketAvailablePriceMin_IN:2600},
    {id:'2',title:'Second',priceMin:26,marketAvailablePriceMin_IN:2400},
    {id:'3',title:'Third',priceMin:24,marketAvailablePriceMin_IN:2000},
  ];
  const fields=[];
  const index={search:async(_q,options)=>{
    fields.push(options.attributesToRetrieve);
    return {hits:docs.slice(options.offset,options.offset+options.limit),totalHits:docs.length};
  }};
  const spec={shop:'fixture.myshopify.com',sortBy:'price-ascending',priceSortField:'marketAvailablePriceMin_IN',
    query:{indexUid:'products',q:'',filter:[]},pinnedIds:[],globalSettings:{prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true}};
  const result=await prepareCollectionRanking(spec,{index,prisma:{},arrange:products=>products,
    comparator:()=>((a,b)=>a.priceMin-b.priceMin)});
  assert.deepEqual(result.ids,['3','2','1']);
  assert.ok(fields[0].includes('marketAvailablePriceMin_IN'));
  assert.deepEqual(docs.map(item=>item.priceMin),[20,26,24],'the index source retains actual base prices for storefront verification');
});

test('an incomplete market sort field fails instead of returning a misleading price order',async()=>{
  const spec={shop:'fixture.myshopify.com',sortBy:'price-ascending',priceSortField:'marketAvailablePriceMin_IN',
    query:{indexUid:'products',q:'',filter:[]},pinnedIds:[]};
  await assert.rejects(()=>prepareCollectionRanking(spec,{index:{search:async()=>({hits:[{id:'1',priceMin:20}],totalHits:1})},
    prisma:{},arrange:products=>products,comparator:()=>((a,b)=>a.priceMin-b.priceMin)}),/Incomplete market price sort index/);
});

test('market prices survive the bounded variant hydration path',async()=>{
  const documents=[
    {id:'1',title:'One',priceMin:10,marketAvailablePriceMin_IN:300,variantPrices:[{id:'11',price:10,available:true}]},
    {id:'2',title:'Two',priceMin:20,marketAvailablePriceMin_IN:100,variantPrices:[{id:'22',price:20,available:true}]},
  ];
  const index={
    search:async(_query,options)=>({hits:documents.slice(options.offset||0,(options.offset||0)+(options.limit||25))
      .map(row=>Object.fromEntries((options.attributesToRetrieve||Object.keys(row)).filter(key=>key in row).map(key=>[key,row[key]]))),totalHits:2}),
    getDocuments:async options=>({results:documents.filter(row=>JSON.parse(options.filter.slice(6)).includes(row.id))
      .map(row=>Object.fromEntries(options.fields.filter(key=>key in row).map(key=>[key,row[key]])))})
  };
  const spec={shop:'fixture.myshopify.com',sortBy:'price-ascending',priceSortField:'marketAvailablePriceMin_IN',
    query:{indexUid:'products',q:'',filter:[]},pinnedIds:[],globalSettings:{prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true}};
  const result=await prepareCollectionRanking(spec,{index,prisma:{},arrange:products=>products,
    comparator:()=>((a,b)=>a.priceMin-b.priceMin)});
  assert.deepEqual(result.ids,['2','1']);
});
