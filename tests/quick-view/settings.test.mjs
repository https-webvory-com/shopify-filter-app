import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as filterWidths from '../../app/utils/filterWidths.js';
import * as collectionLayoutSettings from '../../app/utils/collectionLayoutSettings.js';

async function moduleWithMocks(file, imports) {
  imports = { '@shopify/app-bridge-react': {}, '../hooks/useCompletedSubmission': {useCompletedSubmission:()=>{}}, '../utils/filterWidths.js': filterWidths, '../utils/collectionLayoutSettings.js':collectionLayoutSettings,
    '../db.server.js': {}, '../services/marketAvailability.server.js': {}, ...imports };
  const { code } = await transform(await fs.readFile(file, 'utf8'), { loader: 'jsx', format: 'cjs' });
  const context = { module: { exports: {} }, exports: {}, Response, URL, console,
    require: name => { if (!(name in imports)) throw new Error(`Unexpected import ${name}`); return imports[name]; } };
  vm.runInNewContext(code, context);
  return context.module.exports;
}

test('General Settings persists chart visibility and both Quick View modes', async () => {
  let saved;
  const route = await moduleWithMocks('app/routes/app.settings.general.jsx', {
    'react-router': {}, react: {}, '@shopify/shopify-app-react-router/server': {},
    '../shopify.server': { authenticate: { admin: async () => ({ session: { shop: 'fixture.myshopify.com' } }) } },
    '../services/filterSettings.server': { updateFilterGlobalSettings: async (shop, data) => { saved = { shop, ...data }; } },
  });
  for (const enabled of [true, false]) {
    const request = new Request('https://fixture.test/settings', { method: 'POST', body: new URLSearchParams({
      showQuickViewSizeChart: String(enabled), quickViewStyle: 'theme', showQuickViewInstantSearch: 'true', showQuickViewCollection: 'false',
      quickViewInstantSearchStyle: 'app', showQuickViewInstantSearchSizeChart: String(!enabled),
    }) });
    assert.equal((await route.action({ request })).status, 200);
    assert.equal(saved.showQuickViewSizeChart, enabled);
    assert.equal(saved.quickViewStyle, 'theme');
    assert.equal(saved.quickViewInstantSearchStyle, 'app');
    assert.equal(saved.showQuickViewInstantSearchSizeChart, !enabled);
    assert.equal(saved.showQuickViewInstantSearch, true);
    assert.equal(saved.showQuickViewCollection, false);
    assert.equal(saved.shop, 'fixture.myshopify.com');
  }
  // An admin page loaded before rollout must not silently opt an existing shop out.
  await route.action({ request: new Request('https://fixture.test/settings', { method: 'POST', body: new URLSearchParams({ showQuickViewInstantSearch: 'true' }) }) });
  assert.equal(Object.hasOwn(saved, 'showQuickViewSizeChart'), false);
  assert.equal(Object.hasOwn(saved, 'quickViewStyle'), false);
  assert.equal(Object.hasOwn(saved, 'quickViewInstantSearchStyle'), false);
  assert.equal(Object.hasOwn(saved, 'showQuickViewInstantSearchSizeChart'), false);
  for (const style of ['app', 'invalid']) {
    await route.action({ request: new Request('https://fixture.test/settings', { method: 'POST', body: new URLSearchParams({ quickViewStyle: style }) }) });
    assert.equal(saved.quickViewStyle, 'app');
  }
});

test('settings update awaits cache invalidation before returning', async () => {
  const events = [];
  const service = await moduleWithMocks('app/services/filterSettings.server.js', {
    '../db.server': { default: { filterGlobalSetting: { upsert: async args => { events.push(args); return args.update; } } }, __esModule: true },
    './shopCache.server': { invalidateShop: async shop => { await new Promise(resolve => setTimeout(resolve, 10)); events.push(shop); } },
  });
  const result = await service.updateFilterGlobalSettings('fixture.myshopify.com', { showQuickViewSizeChart: false });
  assert.equal(result.showQuickViewSizeChart, false);
  assert.equal(events[0].create.showQuickViewSizeChart, false);
  assert.equal(events[1], 'fixture.myshopify.com');
});

test('public Quick View configuration exposes only flags and never creates shops', async () => {
  let reads = 0;
  let allowed = true;
  const route = await moduleWithMocks('app/routes/api.quick-view.jsx', {
    '../db.server': { __esModule: true, default: { filterGlobalSetting: { findUnique: async () => {
      reads++;
      return { quickViewStyle: 'theme', showQuickViewSizeChart: true, showQuickViewCollection: false, integrations: { private: 'not public' }, shop: 'fixture.myshopify.com' };
    } } } },
    '../services/shopCache.server': { getCached: async (key, read) => { assert.ok(key.startsWith('quickViewSettings:')); return read(); } },
    '../services/rateLimiter.server': { rateLimit: async () => allowed },
  });
  const load = shop => route.loader({ request: new Request(`https://fixture.test/api/quick-view?shop=${shop}`) });
  assert.equal((await load('invalid.example')).status, 400);
  assert.equal(reads, 0);
  const response = await load('fixture.myshopify.com');
  const flags = await response.json();
  assert.equal(flags.quickViewStyle, 'theme');
  assert.equal(flags.quickViewInstantSearchStyle, 'theme');
  assert.equal(flags.showQuickViewInstantSearchSizeChart, true);
  assert.equal(flags.showQuickViewCollection, false);
  assert.equal(flags.showQuickViewCollectionMobile, false);
  assert.equal(flags.showQuickViewInstantSearchMobile, true);
  assert.deepEqual(Object.keys(flags).sort(), ['isWholesale', 'quickViewStyle', 'quickViewInstantSearchStyle', 'showQuickViewInstantSearchSizeChart', 'showQuickViewCollection', 'showQuickViewInstantSearch', 'showQuickViewSizeChart', 'showQuickViewCollectionMobile', 'showQuickViewInstantSearchMobile'].sort());
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  allowed = false;
  assert.equal((await load('fixture.myshopify.com')).status, 429);
  assert.equal(reads, 1);
});


test('each General toggle updates only its own field and rejects malformed submissions', async()=>{
 let saved,calls=0;
 const route=await moduleWithMocks('app/routes/app.settings.general.jsx',{
  'react-router':{},react:{},'@shopify/shopify-app-react-router/server':{},'@shopify/app-bridge-react':{},
  '../shopify.server':{authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})}},
  '../services/filterSettings.server':{updateFilterGlobalSettings:async(_shop,data)=>{saved=data;calls++;}},
 });
 const post=body=>route.action({request:new Request('https://fixture.test/settings',{method:'POST',body:new URLSearchParams(body)})});
 for(const key of ['showOnlyInStock','secondImageOnHover','showQuickViewInstantSearch','showQuickViewCollection','showQuickViewCollectionMobile','showQuickViewInstantSearchMobile','showQuickViewSizeChart','showQuickViewInstantSearchSizeChart','isWholesale']){
  for(const value of ['true','false']){assert.equal((await post({[key]:value})).status,200);assert.deepEqual(Object.keys(saved),[key]);assert.equal(saved[key],value==='true');}
 }
 const before=calls;
 for(const body of [{},{showOnlyInStock:'yes'},{showQuickViewCollection:''}])assert.equal((await post(body)).status,400);
 assert.equal(calls,before);
});


test('every Filter setting saves independently with authenticated tenant and strict validation',async()=>{
 let saved,calls=0;
 const route=await moduleWithMocks('app/routes/app.filters.settings.jsx',{
  'react-router':{},react:{},'@shopify/shopify-app-react-router/server':{},'@shopify/app-bridge-react':{},
  '../shopify.server':{authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})}},
  '../services/filterSettings.server':{updateFilterGlobalSettings:async(shop,data)=>{assert.equal(shop,'fixture.myshopify.com');saved=data;calls++;}},
 });
 const post=body=>route.action({request:new Request('https://fixture.test/settings',{method:'POST',body:new URLSearchParams(body)})});
 for(const key of ['horizontalFilters','showAttributeBasedBreadcrumb','showFilterOptionsWithOneItem','showProductCount','scrollUpOnFilterValuesChange','hideUnavailableVariantsWhenSelected','prioritizeSortOverPinning','prioritizeSortOverMerchandising']){
  for(const value of ['true','false']){assert.equal((await post({[key]:value})).success,true);assert.deepEqual(Object.keys(saved),[key]);assert.equal(saved[key],value==='true');}
 }
 for(const [key,values]of Object.entries({desktopFilterLayout:['horizontal','vertical','drawer'],mobileFilterLayout:['off-canvas','horizontal-scrolling']})){
  for(const value of values){assert.equal((await post({[key]:value})).success,true);assert.equal(saved[key],value);}
 }
 const before=calls;for(const body of [{},{desktopFilterLayout:'invalid'},{mobileFilterLayout:'invalid'},{darkMode:'yes'},{desktopLikeOnMobile:'true'}])assert.equal((await post(body)).success,false);
 assert.equal(calls,before);
});

test('Theme Setup detects only active current embeds and never exposes theme configuration',async()=>{
 let content,failed=false;
 const route=await moduleWithMocks('app/routes/app.settings.theme-setup.jsx',{
  'react-router':{},react:{},'@shopify/shopify-app-react-router/server':{},'@shopify/app-bridge-react':{},
  '../graphql/queries':{GET_THEME:'themes',GET_THEME_SETTINGS:'settings'},
  '../shopify.server': { authenticate: { admin: async () => ({
    session: { shop: 'fixture.myshopify.com' },
    admin: { graphql: async query => ({ json: async () => {
      if (query === 'themes') return {data:{themes:{edges:[{node:{id:'gid://shopify/OnlineStoreTheme/123',name:'Draft',role:'UNPUBLISHED'}}]}}};
      if (failed) return {errors:[{message:'denied'}]};
      return {data:{theme:{files:{nodes:[{body:{content}}]}}}};
    } }) },
  }) } },
 });
 const read=async()=> (await route.loader({request:new Request('https://fixture.test/settings')})).themes[0];
 content='/* Shopify generated */'+JSON.stringify({current:{blocks:{x:{type:'shopify://apps/ai-smart-search-filter/blocks/collection_loading/id',disabled:false}}},presets:{}});
 let theme=await read();assert.equal(theme.canPreview,true);assert.equal(theme.settingsVerified,true);assert.equal(Object.hasOwn(theme,'rawAssetContent'),false);
 content=JSON.stringify({current:{blocks:{x:{type:'shopify://apps/ai-smart-search-filter/blocks/instant_search/id',disabled:true}}},presets:{old:{type:'shopify://apps/ai-smart-search-filter/blocks/instant_search/id'}}});
 assert.equal((await read()).canPreview,false);
 failed=true;assert.equal((await read()).settingsVerified,false);
});


test('saving another filter preference retains the saved desktop layout in the response',async()=>{
 const service=await moduleWithMocks('app/services/filterSettings.server.js',{
  '../db.server':{__esModule:true,default:{filterGlobalSetting:{upsert:async args=>({horizontalFilters:false,integrations:{desktopFilterLayout:'vertical'},...args.update})}}},
  './shopCache.server':{invalidateShop:async()=>{}},
 });
 const result=await service.updateFilterGlobalSettings('fixture.myshopify.com',{showProductCount:false});
 assert.equal(result.desktopFilterLayout,'vertical');assert.equal(result.showProductCount,false);
});

test('small-screen Quick View preferences preserve other integration settings and each other', async()=>{
 let integrations={wishlist:true,desktopFilterLayout:'vertical'};
 const service=await moduleWithMocks('app/services/filterSettings.server.js',{
  '../db.server':{__esModule:true,default:{filterGlobalSetting:{
   findUnique:async()=>({integrations}),
   upsert:async args=>{assert.equal(Object.hasOwn(args.update,'showQuickViewCollectionMobile'),false);assert.equal(Object.hasOwn(args.update,'showQuickViewInstantSearchMobile'),false);integrations=args.update.integrations;return args.update;},
  }}},
  './shopCache.server':{invalidateShop:async()=>{}},
 });
 await service.updateFilterGlobalSettings('fixture.myshopify.com',{showQuickViewCollectionMobile:false});
 await service.updateFilterGlobalSettings('fixture.myshopify.com',{showQuickViewInstantSearchMobile:false});
 assert.equal(integrations.wishlist,true);assert.equal(integrations.desktopFilterLayout,'vertical');
 assert.equal(integrations.showQuickViewCollectionMobile,false);assert.equal(integrations.showQuickViewInstantSearchMobile,false);
 await service.updateFilterGlobalSettings('fixture.myshopify.com',{showQuickViewCollectionMobile:true});
 assert.equal(integrations.showQuickViewInstantSearchMobile,false);assert.equal(integrations.showQuickViewCollectionMobile,true);
});
