import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const liquid=await fs.readFile('extensions/theme-extension/snippets/collectionFilterPro.liquid','utf8');
const start=liquid.indexOf('(function()',liquid.indexOf('LIGHTHOUSE OPTIMIZATION'));
const inline=liquid.slice(start,liquid.indexOf('})();',start)+5).replace(/\{\{[^}]+\}\}/g,'fixture');
function initial(search=''){
 const calls=[];
 const window={location:{pathname:'/collections/fixture',search},Shopify:{country:'IN',locale:'en'},cfpCustomerTags:'vip'};
 vm.runInNewContext(inline,{window,URLSearchParams,AbortController,document:{documentElement:{lang:'en'}},fetch:async(url,options)=>{
   calls.push({url,options});return {json:async()=>({products:[]})};
 }});
 return {window,calls};
}
test('early request includes exact collection, shop, market, customer, sort and page context',()=>{
 const f=initial('?sortBy=price-ascending&rankingToken=old&preview_theme_id=1');
 assert.equal(f.calls.length,1);
 const params=new URL(f.calls[0].url).searchParams;
 assert.equal(params.get('sortBy'),'price-ascending');assert.equal(params.get('shop'),'fixture');
 assert.equal(params.get('country'),'IN');assert.equal(params.get('customer_tags'),'vip');
 assert.equal(params.get('page'),'1');assert.equal(params.get('limit'),'25');assert.equal(params.get('collectionHandle'),'fixture');
 assert.equal(params.has('rankingToken'),false);assert.equal(params.has('preview_theme_id'),false);
 assert.equal(f.calls[0].options.cache,'no-store');
});
test('filtered links and later pages wait for the complete state parser',()=>{
 for(const search of ['?vendors=Vendor','?options[Color][]=Blue','?page=2&rankingToken=token','?minPrice=10']) assert.equal(initial(search).calls.length,0);
 assert.equal(initial('?utm_source=test').calls.length,1);
});
const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
const consume=source.slice(source.indexOf('        if (window._cfpEarlyFetch &&'),source.indexOf('        if (!data)',source.indexOf('        if (window._cfpEarlyFetch &&')));
async function consumeEarly(params,expected){
 const early=new AbortController();const controller=new AbortController();
 const window={_cfpEarlyFetch:Promise.resolve({marker:'early'}),_cfpEarlyFetchParams:params,_cfpEarlyFetchController:early};
 const context={window,URLSearchParams,isLoadMore:false,activeFilters:{page:1},queryParams:new URLSearchParams(expected),fetchSignal:controller.signal};
 const result=await vm.runInNewContext('(async()=>{let data=null;'+consume+';return data;})()',context);
 return {result,early,window};
}
test('early results are reused only for an exact matching request context',async()=>{
 const match=await consumeEarly('country=IN&shop=fixture','shop=fixture&country=IN');
 assert.equal(match.result.marker,'early');assert.equal(match.window._cfpEarlyFetch,undefined);
 const mismatch=await consumeEarly('country=IN&shop=fixture','shop=fixture&country=US');
 assert.equal(mismatch.result,null);assert.equal(mismatch.early.signal.aborted,true);
});
