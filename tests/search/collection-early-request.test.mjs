import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const js=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
const helper=js.slice(js.indexOf('  async function takeEarlyCollectionResponse('),js.indexOf('  async function waitForCollectionOrder('));
const liquid=await fs.readFile('extensions/theme-extension/snippets/collectionFilterPro.liquid','utf8');
const inline=liquid.slice(liquid.indexOf('  (function() {',liquid.indexOf('Fire API request')),liquid.indexOf('</script>',liquid.indexOf('Fire API request')))
  .replace('{{ shop.permanent_domain }}','fixture.myshopify.com').replace('{{ cfp_collection_handle }}','formal-dresses').replace('{{ cfp_collection_id }}','1').replaceAll('{{ request.locale.iso_code }}','en');
function fixture(search='',tags=''){
  const calls=[],window={location:{pathname:'/collections/formal-dresses',search},Shopify:{locale:'en',country:'US'},cfpCustomerTags:tags};
  const context={window,document:{documentElement:{lang:'en'}},URL,URLSearchParams,AbortController,DOMException,setTimeout,clearTimeout,fetch:async(url,options)=>{calls.push({url,options});return {status:200,json:async()=>({products:['correct'],debug:{collectionRankingStatus:'ready'}})};}};
  vm.runInNewContext(inline,context);vm.runInNewContext(helper,context);
  return {window,calls,take:context.takeEarlyCollectionResponse};
}
test('ranked first page starts early with the exact locale, market, customer and pagination context',async()=>{
  const f=fixture('?utm_source=test&rankingToken=old','VIP');assert.equal(f.calls.length,1);
  const params=new URL(f.calls[0].url).searchParams;assert.equal(params.get('country'),'US');assert.equal(params.get('customer_tags'),'VIP');assert.equal(params.get('page'),'1');assert.equal(params.get('limit'),'25');assert.equal(params.get('sortBy'),'best-selling');assert.equal(params.has('rankingToken'),false);assert.equal(params.has('utm_source'),false);
  params.sort();const response=await f.take('https://aisearchfilter.webvory.com/api/filter?'+params,new AbortController().signal);
  assert.equal((await response.json()).products[0],'correct');assert.equal(await f.take(f.calls[0].url,new AbortController().signal),null);assert.equal(f.calls.length,1);
});
test('filtered and later-page visits do not start speculative ranked requests',()=>{
  for(const search of ['?page=2','?minPrice=50','?maxPrice=200','?vendors=Vendor','?option_Color=Blue','?q=dress','?options[Color][]=Blue','?tags[]=sale'])assert.equal(fixture(search).calls.length,0,search);
});
test('a different sort, filter, market, customer or shop rejects and aborts the early response',async()=>{
  for(const change of ['sortBy=price-ascending','country=CA','customer_tags=other','shop=other.myshopify.com','minPrice=90']){
    const f=fixture();const u=new URL(f.calls[0].url);const [k,v]=change.split('=');u.searchParams.set(k,v);
    assert.equal(await f.take(u.toString(),new AbortController().signal),null);assert.equal(f.calls[0].options.signal.aborted,true);
  }
});
test('filter changes cancel an early request before it can render',async()=>{
  const f=fixture();f.window._cfpRankedEarlyFetch.promise=new Promise(()=>{});const c=new AbortController();const response=f.take(f.calls[0].url,c.signal);c.abort();await assert.rejects(response,{name:'AbortError'});assert.equal(f.calls[0].options.signal.aborted,true);
});
test('early pending and failures retain ordinary readiness and Retry semantics',async()=>{
  for(const status of [202,503]){const f=fixture();f.window._cfpRankedEarlyFetch.promise=Promise.resolve({status,payload:{products:[],debug:{collectionRankingStatus:'pending'}}});assert.equal((await f.take(f.calls[0].url,new AbortController().signal)).status,status);}
  const f=fixture();f.window._cfpRankedEarlyFetch.promise=Promise.resolve({status:429,payload:{error:'Too many requests'}});await assert.rejects(f.take(f.calls[0].url,new AbortController().signal),/Too many/);
});

test('the first-page request is emitted before blocking stylesheets and widget markup',()=>{
  const start=liquid.indexOf('Fire API request');
  assert.ok(start>liquid.indexOf('assign cfp_collection_handle'));
  assert.ok(start<liquid.indexOf('stylesheet_tag'));
  assert.ok(start<liquid.indexOf('<div id="cfp-sidebar"'));
  assert.ok(liquid.indexOf('window.cfpCustomerTags')<start);
  assert.equal(liquid.split('Fire API request').length-1,1);
});
test('collection cards are visible immediately while search retains its reveal timing',()=>{
  assert.ok(js.includes("templateName === 'search' ? Math.min(productIndex, 5) * 75 : 0"));
  assert.ok(js.includes("templateName === 'search' ? 300 : 0"));
});
