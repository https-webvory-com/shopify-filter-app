import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {priceSortVariant} from '../../app/utils/savedMarketPricing.js';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';

const context={version:2,country:'US',currency:'USD',basePrice:true,stockOnly:true,direction:'desc',options:{},mergedValues:[],ranges:[]};
const product={id:'1',options:[{name:'Color'},{name:'Size'}],variantPrices:[{id:'11',price:3190,available:true,option1:'Blue',option2:'S'},{id:'12',price:3410,available:true,option1:'Blue',option2:'L'},{id:'13',price:9000,available:false,option1:'Red',option2:'L'}]};

test('same variable-price product uses lowest eligible price ascending and highest descending',()=>{
 assert.equal(priceSortVariant(product,{...context,direction:'asc'}).price,3190);
 assert.equal(priceSortVariant(product,context).price,3410);
 assert.equal(priceSortVariant(product,{...context,ranges:[{min:3000,max:3300}]}).price,3190);
 assert.equal(priceSortVariant(product,{...context,ranges:[{min:3200,max:3300}]}),null);
 assert.equal(priceSortVariant(product,{...context,stockOnly:false}).price,9000);
});

test('price, aliases and all selected options must match the same eligible variant',()=>{
 const merged=[{optionName:'Color',targetValue:'Navy',sourceValues:['Blue']}];
 assert.equal(priceSortVariant(product,{...context,options:{Color:['Navy'],Size:['S']},mergedValues:merged}).variantId,'11');
 assert.equal(priceSortVariant(product,{...context,options:{Color:['Blue'],Size:['L']},ranges:[{min:3000,max:3300}]}),null);
});

test('country prices never use base currency or accept invalid amounts',()=>{
 const p={...product,variantPrices:product.variantPrices.map((v,i)=>({...v,marketPrices:{IN:{price:i===0?308200:329400,currency:'INR'}}}))};
 assert.equal(priceSortVariant(p,{...context,basePrice:false,country:'IN'}).price,329400);
 assert.equal(priceSortVariant(p,{...context,basePrice:false,country:'GB'}),null);
 for(const price of [null,'',-1,Infinity,NaN])assert.equal(priceSortVariant({variants:[{id:'1',price,available:true}]},context),null);
 assert.equal(priceSortVariant({variants:[{id:'1',price:0,available:true}]},context).price,0);
});

test('background ranker shares variant selection and persists it with the ordered IDs',async()=>{
 const docs=[product,{id:'2',options:[],variantPrices:[{id:'21',price:3202,available:true}]}];
 const index={search:async(_q,options)=>({hits:docs.slice(options.offset,options.offset+options.limit),totalHits:2})};
 for(const [direction,expected]of [['desc',['1','2']],['asc',['1','2']]]){
  const spec={shop:'fixture.myshopify.com',sortBy:direction==='desc'?'price-descending':'price-ascending',priceSortField:'priceMax',variantPriceSort:{...context,direction},query:{q:'',filter:[]},pinnedIds:[],globalSettings:{prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true}};
  const result=await prepareCollectionRanking(spec,{index,prisma:{},arrange:p=>p,comparator:()=>((a,b)=>(a.priceMin-b.priceMin)*(direction==='desc'?-1:1))});
  assert.deepEqual(result.ids,expected);assert.equal(result.metadata['1'].priceSortSelection.price,direction==='desc'?3410:3190);
 }
 const filtered=await prepareCollectionRanking({shop:'fixture.myshopify.com',sortBy:'price-descending',priceSortField:'priceMax',variantPriceSort:{...context,ranges:[{min:3000,max:3300}]},query:{q:'',filter:[]},pinnedIds:[]},{index,prisma:{},arrange:p=>p,comparator:()=>((a,b)=>b.priceMin-a.priceMin)});
 assert.deepEqual(filtered.ids,['2','1']);assert.equal(filtered.metadata['1'].priceSortSelection.price,3190);
});

test('renderer honors server-selected variant inside the active price band',async()=>{
 const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
 const code=source.slice(source.indexOf('  function priceSortedVariant('),source.indexOf('  function updateMarketCardPrice('));
 const state={window:{Shopify:{country:'US'}},activeFilters:{sortBy:'price-descending'}};
 vm.runInNewContext(code,state);
 assert.equal(state.priceSortedVariant(product.variantPrices,{version:2,country:'US',variantId:'11',price:3190}).id,'11');
});

test('merchandising ranker reads compact saved price selections without scanning variant arrays',async()=>{
 const docs=[{id:'1',title:'Variable dress'},{id:'2',title:'Fixed dress'}],queries=[];
 const index={search:async(_q,options)=>{queries.push(options);return {hits:docs.slice(options.offset,options.offset+options.limit),totalHits:2};}};
 const prisma={$queryRaw:async()=>[{id:'gid://shopify/Product/1',selectedVariantId:'gid://shopify/ProductVariant/11',price:3190,currency:'USD',total:2},{id:'gid://shopify/Product/2',selectedVariantId:'gid://shopify/ProductVariant/21',price:3202,currency:'USD',total:2}]};
 const result=await prepareCollectionRanking({shop:'fixture.myshopify.com',sortBy:'price-descending',priceSortField:'priceMax',variantPriceSort:{...context,ranges:[{min:3000,max:3300}]},query:{q:'',filter:[]},pinnedIds:[]},{index,prisma,arrange:p=>p,comparator:()=>((a,b)=>b.priceMin-a.priceMin)});
 assert.deepEqual(result.ids,['2','1']);assert.equal(result.metadata['1'].priceSortSelection.variantId,'11');
 assert.ok(queries.every(query=>!query.attributesToRetrieve.includes('variantPrices')));
});
