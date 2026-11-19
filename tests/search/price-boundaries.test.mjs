import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {convertedPriceBound} from '../../app/utils/priceBounds.js';
import {availableProductIds,matchingAvailableVariants} from '../../app/utils/availableVariants.js';
import {priceSortVariant} from '../../app/utils/savedMarketPricing.js';

test('converted labels and API bounds share decimal half-up rounding, including adjacent minor units',async()=>{
 const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
 const code=source.split('/* CFP_PRICE_BOUNDS_START */')[1].split('/* CFP_PRICE_BOUNDS_END */')[0];
 const context={};vm.runInNewContext(code,context);
 for(const [amount,rate,digits,expected] of [[59,95.434,0,5631],[99,95.434,0,9448],[1.005,1,2,1.01],[0.1,10.05,2,1.01],[59,1,2,59],[99,1,2,99],[1e-7,1e7,2,1],[Infinity,1,0,Infinity]]){
  assert.equal(convertedPriceBound(amount,rate,digits),expected);
  assert.equal(context.convertedPriceBound(amount,rate,digits),expected);
 }
});

for(const [country,currency,min,max,step] of [['IN','INR',5631,9448,0.01],['GB','GBP',59,99,0.01]])test(`${currency} inclusive boundaries use one available Red/M variant in SQL and fallback`,async()=>{
 const options=[{name:'Color'},{name:'Size'}],filters={Color:['Red'],Size:['M']};
 const amounts=[Number((min-step).toFixed(2)),min,Number((min+step).toFixed(2)),Number((max-step).toFixed(2)),max,Number((max+step).toFixed(2)),9600];
 const products=amounts.map((price,i)=>({id:String(i),options,variants:[{id:String(i+100),option1:'Red',option2:'M',price:75,available:true,marketPrices:{[country]:{price,currency}}}]}));
 // Neither a cheaper size nor a cheaper colour can make Red/M eligible.
 products.at(-1).variants.push({id:'200',option1:'Red',option2:'L',available:true,marketPrices:{[country]:{price:min,currency}}},{id:'201',option1:'Blue',option2:'M',available:true,marketPrices:{[country]:{price:min,currency}}});
 const context={version:2,country,stockOnly:true,requirePrice:true,options:filters,mergedValues:[],ranges:[{min,max}]};
 const expected=['1','2','3','4'];
 assert.deepEqual(products.filter(p=>matchingAvailableVariants(p,filters,[],null,context).length).map(p=>p.id),expected);
 for(const direction of ['asc','desc'])assert.deepEqual(products.filter(p=>priceSortVariant(p,{...context,direction})).map(p=>p.id),expected);
 const model={findMany:async()=>products};
 assert.deepEqual(await availableProductIds(model,{shop:'fixture'},filters,[],null,{priceContext:context}),expected);
 const queries=[];
 const database={$queryRaw:async query=>{queries.push(query);return expected.map(id=>({id}));}};
 assert.deepEqual(await availableProductIds(model,{shop:'fixture'},filters,[],null,{database,priceContext:context}),expected);
 assert.equal(queries.length,1);assert.ok(queries[0].values.includes(country));assert.ok(queries[0].values.includes(min));assert.ok(queries[0].values.includes(max));
 assert.ok(queries[0].text.includes('v."available" = true'));
 assert.ok(queries[0].text.includes('v."marketPrices"'));
 assert.ok(queries[0].text.includes(' AND '));
});

test('missing, invalid and sold-out market prices cannot pass through a different sort or variant',()=>{
 const context={country:'IN',stockOnly:true,requirePrice:true,ranges:[{min:5631,max:9448}],options:{Color:['Red'],Size:['M']},mergedValues:[]};
 for(const price of [null,'',NaN,-1,9448.01,9600]){
  const p={options:[{name:'Color'},{name:'Size'}],variants:[{id:'63954324390259',option1:'Red',option2:'M',available:true,marketPrices:{IN:{price,currency:'INR'}}}]};
  assert.equal(matchingAvailableVariants(p,context.options,[],null,context).length,0);
  for(const direction of ['asc','desc'])assert.equal(priceSortVariant(p,{...context,direction}),null);
 }
});
