import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
for(const name of ['collectionFilterPro','instantSearch']) {
 const source=await fs.readFile(`extensions/theme-extension/assets/${name}.js`,'utf8');
 const start=source.indexOf(name==='collectionFilterPro'?'      let priceVal = parseFloat(basePrice)':'      let price = "";');
 const end=source.indexOf(name==='collectionFilterPro'?'      const hasSaleTag':'      let productUrl',start);
 const code=source.slice(start,end)+(name==='collectionFilterPro'?'\nresult=price;':'\nresult=price;');
 test(`${name} preserves INR prices without adding a surcharge or rounding upward`,()=>{
  for(const amount of [2450,1025,885.95,2111]) {
   const ctx={basePrice:amount,p:{priceMin:amount},rate:1,symbol:'?',price:'',result:null};
   vm.runInNewContext(code,ctx);
   assert.equal(ctx.result,(name==='instantSearch'?'?':'')+amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
  }
 });
 test(`${name} retains the currency conversion rate without extra adjustment`,()=>{
  const ctx={basePrice:10,p:{priceMin:10},rate:83.5,symbol:'?',price:'',result:null};
  vm.runInNewContext(code,ctx);
  assert.equal(ctx.result,(name==='instantSearch'?'?':'')+'835.00');
 });
}
