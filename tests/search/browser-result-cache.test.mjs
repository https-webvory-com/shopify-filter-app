import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js', 'utf8');
const start = source.indexOf("  const browserResultPrefix = 'cfp:collection-result:v1:';");
const end = source.indexOf('  function decodeCollectionResponse(', start);
assert.ok(start >= 0 && end > start);

function makeCache() {
  const values = new Map();
  const sessionStorage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  let now = 1000000;
  const context = {sessionStorage,URLSearchParams,window:{cfpCustomerLoggedIn:false,cfpCustomerTags:''},
    templateName:'collection',activeFilters:{page:1},PAGE_SIZE:25,Date:{now:()=>now}};
  vm.runInNewContext(source.slice(start,end) + '\nthis.cache={key:browserResultKey,read:readBrowserResult,save:saveBrowserResult};',context);
  return {...context,values,advance:ms=>{now+=ms;}};
}

const params = new URLSearchParams({shop:'fixture.myshopify.com',country:'US',locale:'en',collectionHandle:'formal-dresses',sortBy:'best-selling',page:'1',limit:'25',responseProfile:'collection-v1'});
const result = {products:[{id:'123',handle:'blue-dress',title:'Blue Dress'}],totalCount:1,rankingToken:'valid',settings:[],facets:{tags:[]},globalSettings:{secondImageOnHover:true}};

test('same-tab collection cards survive reload for ten minutes and never cross country or filter scope',()=>{
  const state=makeCache();state.cache.save(params,result);
  assert.equal(state.cache.read(params)?.products[0].id,'123');
  const same=new URLSearchParams(params);same.set('responseProfile','collection-preview-v1');same.set('rankingToken','old-token');
  assert.equal(state.cache.read(same)?.products[0].id,'123');
  const otherCountry=new URLSearchParams(params);otherCountry.set('country','GB');assert.equal(state.cache.read(otherCountry),null);
  const filtered=new URLSearchParams(params);filtered.append('options[Size][]','L');assert.equal(state.cache.read(filtered),null);
  state.advance(10*60*1000);assert.equal(state.cache.read(params),null);
});

test('browser result cache excludes customer scope and incomplete cards',()=>{
  const state=makeCache();state.window.cfpCustomerLoggedIn=true;state.cache.save(params,result);assert.equal(state.values.size,0);
  state.window.cfpCustomerLoggedIn=false;state.window.cfpCustomerTags='VIP';state.cache.save(params,result);assert.equal(state.values.size,0);
  state.window.cfpCustomerTags='';state.cache.save(params,{...result,totalCount:25});assert.equal(state.values.size,0);
  state.cache.save(params,{...result,cfpCards:{preview:true}});assert.equal(state.values.size,0);
  state.cache.save(params,result);assert.equal(state.values.size,1);
});
