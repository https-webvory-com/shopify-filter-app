import test from 'node:test';
import assert from 'node:assert/strict';
import {FILTER_WIDTH_LIMITS,isValidFilterWidth,normalizeFilterWidth} from '../../app/utils/filterWidths.js';
import {loadModule} from './helpers/search-ranking.mjs';

test('filter widths retain existing defaults and accept bounded whole pixels only',()=>{
  assert.equal(FILTER_WIDTH_LIMITS.default,420);
  for(const value of [240,300,420,600,'480'])assert.equal(normalizeFilterWidth(value),Number(value));
  for(const value of [undefined,null,'',0,239,601,320.5,Infinity,'300px','1;display:none',{},[]]){
    assert.equal(isValidFilterWidth(value),false);assert.equal(normalizeFilterWidth(value),420);
  }
});

async function fixture(){
  let row={shop:'width-fixture.myshopify.com',horizontalFilters:true,integrations:{desktopFilterLayout:'horizontal',wishlist:true,filterBarBackgroundColor:'#fbf7f5'}};
  const writes=[],invalidations=[];
  const service=await loadModule('app/services/filterSettings.server.js',{
    '../db.server':{default:{filterGlobalSetting:{findUnique:async()=>row,upsert:async args=>{writes.push(args);row={...row,...args.update};return row;}}}},
    './shopCache.server':{invalidateShop:async shop=>invalidations.push(shop)},
  });
  const route=await loadModule('app/routes/app.filters.settings.jsx',{
    'react-router':{},react:{},'@shopify/shopify-app-react-router/server':{},'@shopify/app-bridge-react':{},
    '../shopify.server':{authenticate:{admin:async()=>({session:{shop:row.shop}})}},
    '../services/filterSettings.server':service,
  });
  return {service,route,writes,invalidations,row:()=>row};
}

test('per-style widths save independently, stay in shop integrations and preserve horizontal layout',async()=>{
  const f=await fixture(),shop=f.row().shop;
  assert.equal((await f.service.getFilterGlobalSettings(shop)).drawerWidth,420);
  assert.equal((await f.service.getFilterGlobalSettings(shop)).verticalFilterWidth,420);
  const first=await f.service.updateFilterGlobalSettings(shop,{drawerWidth:300});
  assert.equal(first.drawerWidth,300);assert.equal(first.verticalFilterWidth,420);
  await f.service.updateFilterGlobalSettings(shop,{verticalFilterWidth:'520'});
  assert.deepEqual(JSON.parse(JSON.stringify(f.row().integrations)),{desktopFilterLayout:'horizontal',wishlist:true,filterBarBackgroundColor:'#fbf7f5',drawerWidth:300,verticalFilterWidth:520});
  assert.ok(f.writes.every(w=>!('drawerWidth'in w.update)&&!('verticalFilterWidth'in w.update)));
  assert.deepEqual(f.invalidations,[shop,shop]);
});

test('invalid admin and internal width updates never mutate saved settings or invalidate caches',async()=>{
  const f=await fixture();
  for(const value of ['',239,601,300.5,'300px','Infinity']){
    const response=await f.route.action({request:new Request('https://fixture/app',{method:'POST',body:new URLSearchParams({drawerWidth:String(value),verticalFilterWidth:'360'})})});
    assert.equal(response.success,false);
    await assert.rejects(f.service.updateFilterGlobalSettings(f.row().shop,{drawerWidth:value}));
  }
  assert.equal(f.writes.length,0);assert.equal(f.invalidations.length,0);
});

test('authenticated admin can apply and reset both width controls without changing layout or the other style',async()=>{
  const f=await fixture();
  for(const [key,value]of [['drawerWidth',240],['verticalFilterWidth',600],['drawerWidth',420],['verticalFilterWidth',420]]){
    const response=await f.route.action({request:new Request('https://fixture/app',{method:'POST',body:new URLSearchParams({[key]:String(value)})})});
    assert.equal(response.success,true);assert.equal(f.row().integrations[key],value);
  }
  assert.equal(f.row().integrations.desktopFilterLayout,'horizontal');assert.equal(f.row().horizontalFilters,true);
  assert.ok(f.writes.every(w=>w.where.shop===f.row().shop));assert.equal(f.invalidations.length,4);
});
