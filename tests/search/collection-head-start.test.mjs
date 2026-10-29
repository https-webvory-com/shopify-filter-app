import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const head=await fs.readFile('extensions/theme-extension/blocks/collection_loading.liquid','utf8');
const bootstrap=await fs.readFile('extensions/theme-extension/assets/collectionLoading.js','utf8');
const body=await fs.readFile('extensions/theme-extension/snippets/collectionFilterPro.liquid','utf8');
test('head runs the bootstrap inline before deferred asset loading, using the same guarded source',async()=>{
 assert.ok(head.includes("{% render 'collection_loading_start' %}"));
 assert.equal(await fs.readFile('extensions/theme-extension/snippets/collection_loading_start.liquid','utf8'),'<script>'+await fs.readFile('extensions/theme-extension/assets/collectionLoading.min.js','utf8')+'</script>\n');
});
function fixture(search='',tags='',delayed=false,options={}){
 let metaPresent=!delayed,callback;const listeners={};
 const calls=[],window={location:new URL('https://store.example/collections/formal'+search),cfpCustomerTags:tags,...(options.shopify?{Shopify:options.shopify}:{})};
 const headScript=bootstrap;
 const start=body.indexOf('  (function() {',body.indexOf('Fire API request'));
 const bodyScript=body.slice(start,body.indexOf('</script>',start)).replace('{{ shop.permanent_domain }}','fixture.myshopify.com').replace('{{ cfp_collection_handle }}','formal').replace('{{ cfp_collection_id }}','1').replaceAll('{{ request.locale.iso_code }}','en');
 const context={window,location:window.location,MutationObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){}},document:{addEventListener:(name,fn)=>listeners[name]=fn,documentElement:{lang:'en'},querySelector:()=>metaPresent?({dataset:{shop:'fixture.myshopify.com',handle:'formal',country:'IN',locale:'en',customerTags:tags}}):null},URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async(url,requestOptions)=>{calls.push({url,options:requestOptions});return options.respond?options.respond(calls.length):{status:200,json:async()=>({products:[],totalCount:0})};}};
 const runHead=()=>vm.runInNewContext(headScript,context);
 if(!options.bodyFirst)runHead();
 return {calls,window,head:runHead,addMeta:()=>{metaPresent=true;callback();},domReady:()=>listeners.DOMContentLoaded?.(),body:()=>vm.runInNewContext(bodyScript,context)};
}
test('head starts the exact market/locale request before widget markup and body consumes it without duplicate fetching',async()=>{
 const f=fixture();assert.equal(f.calls.length,1);const params=new URL(f.calls[0].url).searchParams;
 assert.equal(params.get('country'),'IN');assert.equal(params.get('locale'),'en');assert.equal(params.get('responseProfile'),'collection-preview-v1');
 assert.equal(f.calls[0].options.priority,'high');
 f.body();assert.equal(f.calls.length,1);await f.window._cfpRankedEarlyFetch.promise;
});
test('head preserves customer scope and rejects filtered, manual and later-page URLs',async()=>{
 for(const query of ['?page=2','?minPrice=25','?option_Color=Blue','?sortBy=manual'])assert.equal(fixture(query).calls.length,0,query);
 const privateVisit=fixture('','VIP');assert.equal(new URL(privateVisit.calls[0].url).searchParams.get('customer_tags'),'VIP');assert.equal(new URL(privateVisit.calls[0].url).searchParams.get('responseProfile'),'collection-v1');
 privateVisit.body();assert.equal(privateVisit.calls.length,1);await privateVisit.window._cfpRankedEarlyFetch.promise;
});

test('head and body share one early request for Shopify preview links including _ab',async()=>{
 const flags='?_ab=0&_fd=0&_sc=1&preview_theme_id=193281622387';
 const f=fixture(flags);assert.equal(f.calls.length,1);f.body();assert.equal(f.calls.length,1);
 const p=new URL(f.calls[0].url).searchParams;
 for(const key of ['_ab','_fd','_sc','preview_theme_id'])assert.equal(p.has(key),false);
 await f.window._cfpRankedEarlyFetch.promise;
 for(const suffix of ['&page=2','&minPrice=50','&option_Color=Blue','&unknown_filter=yes'])assert.equal(fixture(flags+suffix).calls.length,0);
});
test('a changed body market cancels the speculative head request instead of rendering a different context',async()=>{
 const f=fixture();f.window.Shopify={country:'US',locale:'en'};f.body();assert.equal(f.calls.length,2);assert.equal(f.calls[0].options.signal.aborted,true);await f.window._cfpRankedEarlyFetch.promise;
});
test('existing collection blocks load the renderer asynchronously in head and preserve a complete-markup marker',async()=>{
 const block=await fs.readFile('extensions/theme-extension/blocks/collection_filter_pro.liquid','utf8');
 const schema=JSON.parse(block.split('{% schema %}')[1].split('{% endschema %}')[0]);
 assert.equal(schema.javascript,'collectionWidget.js');assert.ok(block.includes('id="cfp-collection-ready"'));
});

test('early cards and skeletons use block column settings and the final grid breakpoints',async()=>{
 const block=await fs.readFile('extensions/theme-extension/blocks/collection_filter_pro.liquid','utf8');
 const app=block.match(/<div id="cfp-v1-app-container"[^>]*>/)?.[0];
 assert.ok(app.includes('--cfp-cols-desktop: {{ block.settings.columns_desktop | default: 3 }}'));
 assert.ok(app.includes('--cfp-cols-mobile: {{ block.settings.columns_mobile | default: 2 }}'));
 for(const width of [1300,990])assert.ok(body.includes(`max-width: ${width}px`));
 for(const width of [768,480]){
   assert.ok(bootstrap.includes(`max-width:${width}px`));
   assert.ok(body.includes(`max-width: ${width}px`));
 }
 assert.ok(bootstrap.includes('repeat(var(--cfp-cols-desktop,3),minmax(0,1fr))'));
 assert.ok(bootstrap.includes('repeat(var(--cfp-cols-mobile,2),minmax(0,1fr))'));
 assert.ok(!bootstrap.includes('repeat(4,minmax(0,1fr))'));
 assert.ok(!body.includes('repeat(4, minmax(180px, 1fr))'));
});


test('late head metadata starts once and DOMContentLoaded cannot restart an obsolete market request',async()=>{
 const f=fixture('','',true);assert.equal(f.calls.length,0);f.addMeta();assert.equal(f.calls.length,1);
 f.window.Shopify={country:'US',locale:'en'};f.body();assert.equal(f.calls.length,2);f.domReady();assert.equal(f.calls.length,2);await f.window._cfpRankedEarlyFetch.promise;
});

test('preloaded loader fetches before metadata but displays only after matching customer and market confirmation',async()=>{
 const f=fixture('','',true,{shopify:{shop:'fixture.myshopify.com',country:'IN',locale:'en'}});
 const entry=f.window._cfpRankedEarlyFetch;
 assert.equal(f.calls.length,1);assert.equal(entry.verified,false);
 await entry.promise;assert.equal(entry.delivered,false);assert.equal(f.window.cfpCollectionContext,undefined);
 f.addMeta();await Promise.resolve();
 assert.equal(f.calls.length,1);assert.equal(entry.verified,true);assert.equal(entry.delivered,true);
 assert.equal(f.window.cfpCollectionContext.country,'IN');
});

test('customer or market mismatch aborts provisional cards before they can display',async()=>{
 for(const [tags,country] of [['VIP','IN'],['','US']]){
  const f=fixture('',tags,true,{shopify:{shop:'fixture.myshopify.com',country,locale:'en'}});
  const provisional=f.window._cfpRankedEarlyFetch;await provisional.promise;
  assert.equal(provisional.delivered,false);f.addMeta();
  const confirmed=f.window._cfpRankedEarlyFetch;await confirmed.promise;
  assert.equal(f.calls.length,2);assert.equal(provisional.controller.signal.aborted,true);
  assert.equal(provisional.delivered,false);assert.equal(confirmed.delivered,true);
  const params=new URL(confirmed.url).searchParams;
  assert.equal(params.get('country'),'IN');assert.equal(params.get('customer_tags'),tags||null);
 }
});

test('pending early responses retry independently and deliver ready data without waiting for the widget',async()=>{
 const f=fixture('','',false,{respond:count=>({status:count===1?202:200,headers:{get:()=>'.001'},json:async()=>({products:[],totalCount:0})})});
 const entry=f.window._cfpRankedEarlyFetch;const result=await entry.promise;
 assert.equal(result.status,200);assert.equal(f.calls.length,2);assert.equal(entry.delivered,true);
 f.body();assert.equal(f.calls.length,2);
});

test('a cancelled pending request never retries or delivers obsolete cards',async()=>{
 const f=fixture('','',false,{respond:()=>({status:202,json:async()=>({products:[]})})});
 const entry=f.window._cfpRankedEarlyFetch;await Promise.resolve();entry.controller.abort();
 assert.equal(await entry.promise,null);assert.equal(f.calls.length,1);assert.equal(entry.delivered,false);
});

test('a widget claiming a pending request takes over retries without extending the timeout window',async()=>{
 const f=fixture('','',false,{respond:()=>({status:202,json:async()=>({products:[],debug:{collectionRankingStatus:'pending'}})})});
 const entry=f.window._cfpRankedEarlyFetch;entry.claimed=true;
 assert.equal((await entry.promise).status,202);assert.equal(f.calls.length,1);assert.equal(entry.delivered,false);
});

test('early image selection retains selected variants and collection-specific images',()=>{
 const select=fixture('?page=2').window.cfpFirstRowSelection;
 const product={handle:'formal-gown',images:['https://images.example/default.jpg'],options:[{name:'Color'}],variants:[{id:'gid://shopify/ProductVariant/10',available:true,option1:'Red',imageUrl:'https://images.example/red.jpg'},{id:'11',available:true,option1:'Blue',imageUrl:'https://images.example/blue.jpg'}]};
 assert.equal(select(product,'formal',{}).image,'https://images.example/red.jpg');
 const selected=select({...product,selectedVariantId:'11'},'formal',{});
 assert.equal(selected.image,'https://images.example/blue.jpg');assert.equal(selected.url,'/products/formal-gown?variant=11');
 assert.equal(select({...product,'metafield_custom.plus_size_collection_image':{url:'https://images.example/plus.jpg'}},'plus-size-formal',{}).image,'https://images.example/plus.jpg');
 assert.equal(select({...product,merchandisingImage:'https://images.example/blue.jpg'},'formal',{}).image,'https://images.example/blue.jpg');
 const pinned=select({...product,selectedVariantId:'10',pinnedProductImage:product.images[0]},'formal',{});
 assert.equal(pinned.image,product.images[0]);assert.equal(pinned.url,'/products/formal-gown?variant=10');
});

test('a late head loader adopts ready body-started data without waiting for the full renderer or fetching twice',async()=>{
 const f=fixture('','',false,{bodyFirst:true});f.window.Shopify={country:'IN',locale:'en'};
 f.body();const early=f.window._cfpRankedEarlyFetch;await early.promise;
 assert.equal(f.calls.length,1);assert.equal(early.deliver,undefined);
 f.head();await Promise.resolve();
 assert.equal(f.calls.length,1);assert.equal(early.delivered,true);assert.equal(early.verified,true);
 f.head();assert.equal(f.calls.length,1);
});

test('late adoption cannot render a cancelled body request',async()=>{
 const f=fixture('','',false,{bodyFirst:true});f.window.Shopify={country:'IN',locale:'en'};
 f.body();const early=f.window._cfpRankedEarlyFetch;await early.promise;early.controller.abort();
 f.head();await Promise.resolve();assert.notEqual(early.delivered,true);assert.equal(f.calls.length,1);
});

test('a late body stream callback cannot deliver to a replacement request with the same URL',async()=>{
 const f=fixture('','',false,{bodyFirst:true});f.window.Shopify={country:'IN',locale:'en'};
 let publish,calls=0;
 f.window.cfpReadEarlyResponse=async(_response,onProduct)=>{publish=onProduct;return {status:200,payload:{products:[]}};};
 f.body();const old=f.window._cfpRankedEarlyFetch;await old.promise;
 f.window._cfpRankedEarlyFetch={url:old.url,controller:new AbortController(),deliver:()=>calls++};
 publish({status:200,payload:{products:[{id:'old'}]}});assert.equal(calls,0);
});
