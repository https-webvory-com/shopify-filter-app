import test from 'node:test';
import assert from 'node:assert/strict';
import {compileVariantOptionMatcher} from '../../app/utils/variantOptionMatcher.js';
import {matchingAvailableVariants} from '../../app/utils/availableVariants.js';
import {priceSortVariant} from '../../app/utils/savedMarketPricing.js';

test('compiled choices preserve option positions, aliases, merchant scopes and nonrecursive merges',()=>{
 const options=[{name:'Size'},{name:'Color'}],rules=[{optionName:' Color ',targetValue:'TEAL',sourceValues:['Cyan']},{optionName:'Size',targetValue:'M',sourceValues:['8','Custom Medium']},{optionName:'Color',targetValue:'Cyan',sourceValues:['Turquoise']},{optionName:'Color',targetValue:'M',sourceValues:['Wrong Size']}];
 const match=compileVariantOptionMatcher(options,{Color:[' Teal '],Size:['M']},rules);
 assert.equal(match({option1:'M edium',option2:'TEAL'}),true);
 assert.equal(match({option1:'8',option2:'Cyan'}),true);
 assert.equal(match({option1:'Custom Medium',option2:'Teal'}),true);
 for(const variant of [{option1:'L',option2:'Teal'},{option1:'M',option2:'Dark Teal'},{option1:'M',option2:'Turquoise'},{option1:'Wrong Size',option2:'Teal'},{option1:'Teal',option2:'M'}])assert.equal(match(variant),false);
 assert.equal(compileVariantOptionMatcher([],{Color:['Teal']},rules)({option1:'Teal'}),false);
 assert.equal(compileVariantOptionMatcher([],{Color:[]},rules)({}),true);
 assert.equal(compileVariantOptionMatcher([{name:'Color'}],{Color:['']},[])({option1:null}),true);
 assert.equal(compileVariantOptionMatcher([{name:'Size'}],{Size:['M']},[])({option1:'8'}),false);
});

test('compiled matching does not rescan merchant rules for each variant',()=>{
 let reads=0;const rules=[{optionName:'Color',get targetValue(){reads++;return 'Teal';},sourceValues:['Cyan']}];
 const match=compileVariantOptionMatcher([{name:'Color'}],{Color:['Teal']},rules),preparedReads=reads;
 for(let i=0;i<2000;i++)assert.equal(match({option1:i%2?'Cyan':'Red'}),i%2===1);
 assert.equal(reads,preparedReads);
});

test('same-variant colour, size, saved market currency, availability and inclusive price bounds remain combined',()=>{
 const product={options:[{name:'Color'},{name:'Size'}],variants:[
  {id:'1',option1:'Blue',option2:'L',available:true,marketPrices:{IN:{price:100,currency:'INR'}}},
  {id:'2',option1:'Red',option2:'M',available:true,marketPrices:{IN:{price:100,currency:'INR'}}},
  {id:'3',option1:'Blue',option2:'8',available:true,marketPrices:{IN:{price:100,currency:'INR'}}},
  {id:'4',option1:'Blue',option2:'M',available:false,marketPrices:{IN:{price:100,currency:'INR'}}},
  {id:'5',option1:'Blue',option2:'M',available:true,marketPrices:{IN:{price:100.01,currency:'INR'}}},
  {id:'6',option1:'Blue',option2:'M',available:true,marketPrices:{IN:{price:100,currency:'USD'}}},
 ]};
 const context={country:'IN',currency:'INR',requirePrice:true,stockOnly:true,ranges:[{min:100,max:100}],options:{Color:['Blue'],Size:['M']},mergedValues:[{optionName:'Size',targetValue:'M',sourceValues:['8']}]};
 assert.deepEqual(matchingAvailableVariants(product,context.options,context.mergedValues,null,context).map(v=>v.id),['3']);
 for(const direction of ['asc','desc'])assert.equal(priceSortVariant(product,{...context,direction}).variantId,'3');
 assert.deepEqual(matchingAvailableVariants(product,context.options,context.mergedValues,null,{...context,stockOnly:false}).map(v=>v.id),['3','4']);
 assert.deepEqual(matchingAvailableVariants(product,context.options,context.mergedValues,null,{...context,searchColorValues:['Red']}).map(v=>v.id),[]);
});

test('price selection retains exact ties and ignores empty optional selections',()=>{
 const product={options:[],variants:[{id:'3',price:10,available:true},{id:'21',price:10,available:true}]};
 const result=priceSortVariant(product,{basePrice:true,country:'US',currency:'USD',stockOnly:true,requirePrice:true,direction:'asc',options:{Color:null,Size:[]}});
 assert.equal(result.variantId,'21');assert.equal(result.price,10);
});
