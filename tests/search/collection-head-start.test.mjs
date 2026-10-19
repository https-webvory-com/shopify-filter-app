import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const head=await fs.readFile('extensions/theme-extension/blocks/collection_loading.liquid','utf8');
const bootstrap=await fs.readFile('extensions/theme-extension/assets/collectionLoading.js','utf8');
const body=await fs.readFile('extensions/theme-extension/snippets/collectionFilterPro.liquid','utf8');
function fixture(search='',tags='',delayed=false){
 let metaPresent=!delayed,callback;const listeners={};
 const calls=[],window={location:new URL('https://store.example/collections/formal'+search),cfpCustomerTags:tags};
 const headScript=bootstrap;
 const start=body.indexOf('  (function() {',body.indexOf('Fire API request'));
 const bodyScript=body.slice(start,body.indexOf('</script>',start)).replace('{{ shop.permanent_domain }}','fixture.myshopify.com').replace('{{ cfp_collection_handle }}','formal').replace('{{ cfp_collection_id }}','1').replaceAll('{{ request.locale.iso_code }}','en');
 const context={window,location:window.location,MutationObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){}},document:{addEventListener:(name,fn)=>listeners[name]=fn,documentElement:{lang:'en'},querySelector:()=>metaPresent?({dataset:{shop:'fixture.myshopify.com',handle:'formal',country:'IN',locale:'en',customerTags:tags}}):null},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{calls.push({url,options});return {status:200,json:async()=>({products:[],totalCount:0})};}};
 vm.runInNewContext(headScript,context);
 return {calls,window,addMeta:()=>{metaPresent=true;callback();},domReady:()=>listeners.DOMContentLoaded?.(),body:()=>vm.runInNewContext(bodyScript,context)};
}
test('head starts the exact market/locale request before widget markup and body consumes it without duplicate fetching',async()=>{
 const f=fixture();assert.equal(f.calls.length,1);const params=new URL(f.calls[0].url).searchParams;
 assert.equal(params.get('country'),'IN');assert.equal(params.get('locale'),'en');assert.equal(params.get('responseProfile'),'collection-cards-v1');
 f.body();assert.equal(f.calls.length,1);await f.window._cfpRankedEarlyFetch.promise;
});
test('head preserves customer scope and rejects filtered, manual and later-page URLs',async()=>{
 for(const query of ['?page=2','?minPrice=25','?option_Color=Blue','?sortBy=manual'])assert.equal(fixture(query).calls.length,0,query);
 const privateVisit=fixture('','VIP');assert.equal(new URL(privateVisit.calls[0].url).searchParams.get('customer_tags'),'VIP');assert.equal(new URL(privateVisit.calls[0].url).searchParams.get('responseProfile'),'collection-v1');
 privateVisit.body();assert.equal(privateVisit.calls.length,1);await privateVisit.window._cfpRankedEarlyFetch.promise;
});
test('a changed body market cancels the speculative head request instead of rendering a different context',async()=>{
 const f=fixture();f.window.Shopify={country:'US',locale:'en'};f.body();assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.signal.aborted,true);await f.window._cfpRankedEarlyFetch.promise;
});
test('existing collection blocks load the renderer asynchronously in head and preserve a complete-markup marker',async()=>{
 const block=await fs.readFile('extensions/theme-extension/blocks/collection_filter_pro.liquid','utf8');
 const schema=JSON.parse(block.split('{% schema %}')[1].split('{% endschema %}')[0]);
 assert.equal(schema.javascript,'collectionFilterPro.js');assert.ok(block.includes('id="cfp-collection-ready"'));
});


test('late head metadata starts once and DOMContentLoaded cannot restart an obsolete market request',async()=>{
 const f=fixture('','',true);assert.equal(f.calls.length,0);f.addMeta();assert.equal(f.calls.length,1);
 f.window.Shopify={country:'US',locale:'en'};f.body();assert.equal(f.calls.length,2);f.domReady();assert.equal(f.calls.length,2);await f.window._cfpRankedEarlyFetch.promise;
});
