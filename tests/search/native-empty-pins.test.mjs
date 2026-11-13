import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import * as schema from '../../app/utils/searchSettings.js';
const shop='test.myshopify.com',pin=id=>({id:'gid://shopify/Product/'+id,title:'Dress '+id,image:''});
async function fixture(){
  let config={...structuredClone(schema.DEFAULT_SEARCH_SETTINGS),emptySearchProducts:[pin(1)],_index:{phase:'ready',active:{uid:'existing'}}},rules=[];const events=[];
  const tx={pinnedProductRule:{findFirst:async()=>rules.find(r=>r.shop===shop&&r.searchQueries?.includes(''))||null,create:async({data})=>{const rule={id:'empty',status:true,...data};rules.push(rule);events.push('create');return rule;},update:async({where,data})=>{assert.equal(where.shop,shop);const rule=rules.find(r=>r.id===where.id);Object.assign(rule,data);events.push('update');return rule;},deleteMany:async({where})=>{assert.equal(where.shop,shop);rules=rules.filter(r=>r.id!==where.id);events.push('delete');}},$executeRaw:async(strings,...values)=>{assert.match(strings.join('?'),/jsonb_set\(config,'\{emptySearchProducts\}'/);assert.equal(values[0],shop);config.emptySearchProducts=[];events.push('clear-legacy');}};
  const db={searchSetting:{findUnique:async({where})=>{assert.equal(where.shop,shop);return {config};}},$transaction:async fn=>fn(tx)};
  const service=await loadModule('app/services/emptySearchPins.server.js',{'../db.server.js':{default:db},'../utils/searchSettings.js':schema,'./searchCollectionPicker.server.js':{validateSelectedSearchProducts:async(tenant,products)=>{assert.equal(tenant,shop);if(products.some(p=>p.id.endsWith('/999')))throw Error('Other store product');return products;}},'./searchIndex.server.js':{resetSearchIndexContext:async tenant=>{assert.equal(tenant,shop);events.push('invalidate');}}});
  return {service,events,get config(){return config;},get rules(){return rules;}};
}
test('reading old empty-search selections is read only, and saving creates a normal scoped empty-query rule',async()=>{
  const f=await fixture();assert.deepEqual(JSON.parse(JSON.stringify(await f.service.legacyEmptySearchProducts(shop))),[pin(1)]);assert.deepEqual(f.events,[]);
  await f.service.saveEmptySearchPin(shop,{id:'new',products:[pin(2),pin(1)]});
  assert.equal(f.rules.length,1);assert.deepEqual(Array.from(f.rules[0].searchQueries),['']);assert.equal(f.rules[0].applyToAll,false);assert.equal(f.rules[0].applyToSearchType,'instant');
  assert.deepEqual(JSON.parse(JSON.stringify(f.rules[0].products)),[pin(2),pin(1)]);assert.deepEqual(f.config.emptySearchProducts,[]);assert.equal(f.config._index.active.uid,'existing');assert.equal(f.events.at(-1),'invalidate');
  f.rules[0].status=false;await f.service.saveEmptySearchPin(shop,{id:'new',products:[pin(3)]});assert.equal(f.rules.length,1);assert.equal(f.rules[0].status,false);
});
test('empty pin updates preserve unrelated settings, prevent duplicate targets and verify store products',async()=>{
  const f=await fixture();await f.service.saveEmptySearchPin(shop,{id:'new',products:[pin(2)]});const original=JSON.stringify(f.config._index);
  await assert.rejects(f.service.saveEmptySearchPin(shop,{id:'other-rule',products:[pin(1)]}),/already exists/);
  await assert.rejects(f.service.saveEmptySearchPin(shop,{id:'new',products:[pin(999)]}),/Other store/);
  await f.service.saveEmptySearchPin(shop,{id:'empty',products:[pin(3)],enabled:false});assert.equal(f.rules[0].applyToSearchType,'none');assert.equal(JSON.stringify(f.config._index),original);
  await f.service.saveEmptySearchPin(shop,{id:'empty',products:[]});assert.equal(f.rules.length,0);assert.deepEqual(f.config.emptySearchProducts,[]);
});
