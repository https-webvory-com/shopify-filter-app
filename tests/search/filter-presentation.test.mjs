import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePriceFilter} from '../../app/utils/filterPresentation.js';
import {hasUsableExtraFacets} from '../../app/utils/extraProductFilters.js';
import {loadModule} from './helpers/search-ranking.mjs';

test('every store defaults legacy Price sliders to checkboxes while preserving its own bands',()=>{
  for(const priceRanges of [[{from:59,to:99,label:'{0} - {1}'}],[{from:0,to:50,label:'Under {1}'},{from:50,to:'',label:'From {0}'}]]){
    const saved={filterType:'price',displayMode:'Range',config:JSON.stringify({priceRanges,advanced:{maxHeight:'220px'}})};
    const checkboxes=normalizePriceFilter(saved,{});
    assert.equal(checkboxes.displayMode,'List');assert.deepEqual(checkboxes.config.priceRanges,priceRanges);
    assert.equal(normalizePriceFilter(saved,{integrations:{priceFilterDisplayMode:'Range'}}).displayMode,'Range');
    assert.equal(normalizePriceFilter(saved,{integrations:{priceFilterDisplayMode:'List'}}).displayMode,'List');
    assert.equal(saved.displayMode,'Range');
  }
});

test('legacy slider snapshots without checkbox counts are rebuilt; explicit sliders remain usable',()=>{
  const payload={settings:[{isEnabled:true,filterType:'price',displayMode:'Range',config:{priceRanges:[{from:0,to:50},{from:50,to:''}]}}],facets:{priceRanges:{version:2,ranges:[]}}};
  assert.equal(hasUsableExtraFacets(payload),false);
  assert.equal(hasUsableExtraFacets({...payload,globalSettings:{integrations:{priceFilterDisplayMode:'Range'}}}),true);
  assert.equal(hasUsableExtraFacets({...payload,facets:{priceRanges:{version:2,ranges:[{from:0,to:50,count:10},{from:50,to:'',count:5}]}}}),true);
});

test('Price style and size columns save independently and preserve the toolbar, layout and wishlist',async()=>{
  let row={shop:'fixture.myshopify.com',integrations:{desktopFilterLayout:'drawer',wishlist:true,filterBarBackgroundColor:'#fbf7f5'}};
  let invalidated=0;
  const service=await loadModule('app/services/filterSettings.server.js',{
    '../db.server':{default:{filterGlobalSetting:{findUnique:async()=>row,upsert:async({update})=>(row={...row,...update})}}},
    './shopCache.server':{invalidateShop:async()=>invalidated++},
  });
  assert.equal((await service.getFilterGlobalSettings(row.shop)).sizeOptionsPerRow,4);
  assert.equal((await service.getFilterGlobalSettings(row.shop)).priceFilterDisplayMode,'List');
  await service.updateFilterGlobalSettings(row.shop,{priceFilterDisplayMode:'Range'});
  await service.updateFilterGlobalSettings(row.shop,{sizeOptionsPerRow:3});
  assert.deepEqual(JSON.parse(JSON.stringify(row.integrations)),{desktopFilterLayout:'drawer',wishlist:true,filterBarBackgroundColor:'#fbf7f5',priceFilterDisplayMode:'Range',sizeOptionsPerRow:3});
  assert.equal(invalidated,2);
  const route=await loadModule('app/routes/app.filters.settings.jsx',{
    'react-router':{},react:{},'@shopify/shopify-app-react-router/server':{},'@shopify/app-bridge-react':{},
    '../shopify.server':{authenticate:{admin:async()=>({session:{shop:row.shop}})}},
    '../services/filterSettings.server':{updateFilterGlobalSettings:service.updateFilterGlobalSettings},
  });
  for(const values of [{priceFilterDisplayMode:'List'},{sizeOptionsPerRow:'6'}])assert.equal((await route.action({request:new Request('http://fixture/admin',{method:'POST',body:new URLSearchParams(values)})})).success,true);
  assert.equal(row.integrations.priceFilterDisplayMode,'List');assert.equal(row.integrations.sizeOptionsPerRow,6);
  for(const values of [{priceFilterDisplayMode:'Box'},{sizeOptionsPerRow:'1'},{sizeOptionsPerRow:'7'},{sizeOptionsPerRow:'3.5'}])assert.equal((await route.action({request:new Request('http://fixture/admin',{method:'POST',body:new URLSearchParams(values)})})).success,false);
  assert.equal(invalidated,4);
});
