import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import * as schema from '../../app/utils/searchSettings.js';
import * as configuration from '../../app/utils/searchConfiguration.js';

async function setup(active=true){
 const events=[],config=structuredClone(schema.DEFAULT_SEARCH_SETTINGS);
 const row={config:{...config,...(active?{_index:{active:{uid:'existing-private-index',config:structuredClone(config)}}}:{})}};
 const service=await loadModule('app/services/searchSettings.server.js',{
  '../db.server':{default:{searchSetting:{findUnique:async()=>row,upsert:async value=>events.push(['write',value])}}},
  '../utils/searchSettings.js':schema,'../utils/searchConfiguration.js':configuration,
  './searchIndex.server.js':{resetSearchIndexContext:async()=>events.push(['invalidate']),scheduleSearchIndex:async(shop,options)=>events.push(['schedule',shop,options]),retireSearchIndexes:async()=>{throw Error('Must retain serving index');}},
 });
 return {service,events,config};
}
test('saving a split rule preserves the existing index and requests incremental work only',async()=>{
 const f=await setup();f.config.fields[0].delimiter='|';f.config.fields[0].delimiters=[','];
 await f.service.saveSearchSettings('one.myshopify.com',f.config);
 assert.deepEqual(JSON.parse(JSON.stringify(f.events.at(-1))),['schedule','one.myshopify.com',{allowInitialBuild:false}]);
 assert.equal(f.events[0][1].update.config._index.active.uid,'existing-private-index');
});
test('an unprepared store cannot start a full build by saving a rule',async()=>{
 const f=await setup(false);f.config.fields[0].delimiter=',';
 await assert.rejects(f.service.saveSearchSettings('one.myshopify.com',f.config),error=>error.code==='SEARCH_INDEX_SETUP_REQUIRED');
 assert.equal(f.events.length,0,'refuse before writing settings or scheduling anything');
});
test('fields needing unavailable Shopify metadata leave the saved rules unchanged',async()=>{
 const f=await setup();f.config.fields.find(field=>field.key==='description').search=true;
 await assert.rejects(f.service.saveSearchSettings('one.myshopify.com',f.config),error=>error.code==='SEARCH_INDEX_SOURCE_REQUIRED');
 assert.equal(f.events.length,0,'no settings writes, metadata requests, or catalog jobs');
});
