import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {loadModule} from './helpers/search-ranking.mjs';
import * as filterWidths from '../../app/utils/filterWidths.js';

async function action(file, dependencies) {
  const source=await fs.readFile(file,'utf8');
  const ast=ts.createSourceFile('route.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const initializer=ast.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)==='action')).declarationList.declarations[0].initializer.getText(ast);
  return vm.runInNewContext('('+initializer+')',{
    authenticate:{admin:async()=>({session:{shop:'fixture.myshopify.com'}})},...filterWidths,...dependencies,
  });
}
const request=values=>new Request('http://fixture/admin',{method:'POST',body:new URLSearchParams(values)});

test('toolbar color saves validate custom colors and allow restoring the page background',async()=>{
  const writes=[];
  const save=await action('app/routes/app.filters.settings.jsx',{
    updateFilterGlobalSettings:async(shop,payload)=>writes.push({shop,...payload}),
  });
  for(const value of ['#A1B2C3',''])assert.equal((await save({request:request({filterBarBackgroundColor:value})})).success,true);
  assert.deepEqual(JSON.parse(JSON.stringify(writes)),[
    {shop:'fixture.myshopify.com',filterBarBackgroundColor:'#a1b2c3'},
    {shop:'fixture.myshopify.com',filterBarBackgroundColor:''},
  ]);
  for(const value of ['red','url(https://example.com)','<style>','#xyzxyz'])assert.equal((await save({request:request({filterBarBackgroundColor:value})})).success,false);
  assert.equal(writes.length,2);
});

test('toolbar color persistence preserves layout, wishlist and unrelated settings',async()=>{
  let row={shop:'fixture.myshopify.com',horizontalFilters:true,showProductCount:false,integrations:{desktopFilterLayout:'horizontal',wishlist:true}};
  const invalidations=[];
  const service=await loadModule('app/services/filterSettings.server.js',{
    '../db.server':{default:{filterGlobalSetting:{findUnique:async()=>row,upsert:async({update})=>(row={...row,...update})}}},
    './shopCache.server':{invalidateShop:async shop=>invalidations.push(shop)},
  });
  for(const color of ['#a1b2c3','']){
    await service.updateFilterGlobalSettings(row.shop,{filterBarBackgroundColor:color});
    assert.deepEqual(JSON.parse(JSON.stringify(row.integrations)),{desktopFilterLayout:'horizontal',wishlist:true,filterBarBackgroundColor:color});
    assert.equal(row.horizontalFilters,true);assert.equal(row.showProductCount,false);
    assert.equal((await service.getFilterGlobalSettings(row.shop)).filterBarBackgroundColor,color);
  }
  await service.updateFilterGlobalSettings(row.shop,{desktopFilterLayout:'vertical'});
  assert.equal(row.integrations.filterBarBackgroundColor,'');assert.equal(row.integrations.wishlist,true);
  assert.equal(invalidations.length,3);
});

test('wishlist save preserves filter layout and waits for invalidation; malformed values cannot reset settings',async()=>{
  const writes=[];let release,finished=false;
  const save=await action('app/routes/app.settings.integrations.jsx',{
    prisma:{filterGlobalSetting:{findUnique:async()=>({integrations:{desktopFilterLayout:'vertical'}}),upsert:async value=>writes.push(value)}},
    invalidateShop:()=>new Promise(resolve=>{release=resolve;}),
  });
  const pending=save({request:request({integrations:'{"wishlist":true}'})}).then(value=>{finished=true;return value;});
  while(!release)await Promise.resolve();
  assert.equal(finished,false);
  assert.deepEqual(JSON.parse(JSON.stringify(writes[0].update.integrations)),{desktopFilterLayout:'vertical',wishlist:true});
  release();assert.equal((await pending).success,true);
  for(const value of ['bad','null','[]','{}','{"wishlist":"false"}'])assert.equal((await save({request:request({integrations:value})})).success,false);
  assert.equal(writes.length,1);
});

for(const [file,intent,form,model] of [
  ['app.filters.merged-value.jsx','toggle_status',{id:'merged',isActive:'false'},'mergedValue'],
  ['app.filters.groups.$id.jsx','toggleFilter',{filterId:'color'},'filterGroupItem'],
])test(`${intent} cannot report saved before storefront invalidation finishes`,async()=>{
  let release,finished=false;const events=[];
  const save=await action('app/routes/'+file,{
    prisma:{filterGroup:{findFirst:async()=>({id:'group'})},[model]:{findUnique:async()=>({isEnabled:true}),update:async()=>events.push('write')}},
    invalidateShop:()=>{events.push('invalidate');return new Promise(resolve=>{release=resolve;});},
  });
  const pending=save({request:request({intent,...form}),params:{id:'group'}}).then(value=>{finished=true;return value;});
  while(!release)await Promise.resolve();
  assert.equal(finished,false);assert.deepEqual(events,['write','invalidate']);
  release();assert.equal((await pending).success,true);
});

test('synonyms only update the merchant index and schedule its preparation',async()=>{
  for(const shouldFail of [false,true]){
    const events=[];
    const service=await loadModule('app/services/synonyms.server.js',{
      '../db.server':{default:{synonym:{findMany:async()=>[{word:'gown',synonyms:'dress'}]},searchSetting:{upsert:async value=>events.push(['setting',value.where.shop])}}},
      '../utils/searchSettings.js':{DEFAULT_SEARCH_SETTINGS:{fields:[]}},
      './searchIndex.server.js':{
        syncConfiguredSearchSynonyms:async(shop,dictionary)=>{events.push(['sync',shop,dictionary]);if(shouldFail)throw Error('Index failed');},
        scheduleSearchIndex:async shop=>events.push(['schedule',shop]),
      },
    });
    assert.equal(await service.syncSynonymsToMeilisearch('fixture.myshopify.com'),!shouldFail);
    assert.deepEqual(JSON.parse(JSON.stringify(events)),shouldFail?[
      ['setting','fixture.myshopify.com'],['sync','fixture.myshopify.com',{gown:['dress'],dress:['gown']}],
    ]:[
      ['setting','fixture.myshopify.com'],['sync','fixture.myshopify.com',{gown:['dress'],dress:['gown']}],['schedule','fixture.myshopify.com'],
    ]);
  }
});

for(const actionType of ['createRule','editRule','deleteRule','toggleRule','duplicateRule'])test(`search merchandising ${actionType} refreshes storefront state before success`,async()=>{
  const events=[];
  const model={create:async()=>{events.push('write');return {};},update:async()=>{events.push('write');return {};},
    deleteMany:async()=>events.push('write'),updateMany:async()=>events.push('write'),findFirst:async()=>({name:'Rule',conditions:[]})};
  const save=await action('app/routes/app.search.merchandising.jsx',{
    Response,prisma:{merchandisingRule:model,merchandisingRuleCondition:{deleteMany:async()=>{}}},invalidateShop:async()=>events.push('invalidated'),
  });
  const result=await save({request:request({actionType,id:'rule',conditions:'[]',searchQueries:'["dress"]'})});
  assert.equal((await result.json()).success,true);assert.deepEqual(events,['write','invalidated']);
});
