import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import * as helpers from '../../app/utils/suggestionBlacklist.js';
import { buildSearchSuggestions } from '../../app/utils/searchSuggestions.js';
import { selectSearchColorVariant } from '../../app/utils/searchColor.js';
import { spellingCorrection } from '../../app/utils/spellingCorrection.js';

export async function load(file, mocks) {
  const {code} = await transform(await fs.readFile(file, 'utf8'), {loader:'jsx',format:'cjs'});
  const context = {module:{exports:{}},exports:{},URL,Response,console:{error(){}},require:name=>{
    if (!(name in mocks)) throw Error('Unexpected import '+name);
    return mocks[name];
  }};
  vm.runInNewContext(code, context);
  return context.module.exports;
}
const shop = 'fixture.myshopify.com';
function form(values) { const result=new FormData(); for(const [key,value] of Object.entries(values)) result.set(key,value); return result; }

function database() {
  const rows=new Map(); let next=0;
  const write=(id,data)=>{
    if([...rows.values()].some(row=>row.id!==id&&row.shop===data.shop&&row.term===data.term&&row.operator===data.operator)) throw Object.assign(Error('Conflict'),{code:'P2002'});
    const row={id:id||String(++next),...data}; rows.set(row.id,row); return row;
  };
  const db={searchSuggestionBlacklist:{
    create:async({data})=>write(null,data),
    update:async({where,data})=>{
      const row=rows.get(where.id); if(!row||row.shop!==where.shop) throw Object.assign(Error('Missing'),{code:'P2025'});
      return write(row.id,{...row,...data});
    },
    updateMany:async({where,data})=>{const row=rows.get(where.id);if(!row||row.shop!==where.shop)return {count:0};Object.assign(row,data);return {count:1};},
    deleteMany:async({where})=>{const row=rows.get(where.id);if(!row||row.shop!==where.shop)return {count:0};rows.delete(row.id);return {count:1};},
    findMany:async({where})=>[...rows.values()].filter(row=>row.shop===where.shop&&(where.isActive===undefined||row.isActive===where.isActive)),
  }};
  return {db,rows};
}
async function service(db) {return load('app/services/suggestionBlacklist.server.js',{'../db.server':{__esModule:true,default:db},'../utils/suggestionBlacklist.js':helpers});}

test('Contains matches literal substrings and Exact match compares complete normalized phrases',()=>{
  const suggestions=['Blue Dress','blue   dress','Blue Dress Sale','Sundress','[sale] dresses','Other'];
  assert.deepEqual(helpers.filterBlacklistedSuggestions(suggestions,[{term:' BLUE DRESS ',operator:'exact'}]),['Blue Dress Sale','Sundress','[sale] dresses','Other']);
  assert.deepEqual(helpers.filterBlacklistedSuggestions(suggestions,[{term:'dress',operator:'contains'}]),['Other']);
  assert.deepEqual(helpers.filterBlacklistedSuggestions(suggestions,[{term:'[sale]',operator:'contains'}]),['Blue Dress','blue   dress','Blue Dress Sale','Sundress','Other']);
});
test('disabled, empty and malformed rules do not accidentally suppress every suggestion',()=>{
  const values=['Dress','Sale'];
  assert.deepEqual(helpers.filterBlacklistedSuggestions(values,[{term:'dress',operator:'contains',isActive:false},{term:'',operator:'contains'},{term:'Sale',operator:'regex'},null]),values);
  assert.deepEqual(helpers.filterBlacklistedSuggestions(values,[{term:'Dress',operator:'exact'},{term:'Sale',operator:'contains'}]),[]);
});
test('validation rejects empty/long terms, control characters and unsupported operators',()=>{
  assert.equal(helpers.validateSuggestionBlacklist('  BLUE  DRESS  ','exact').term,'blue dress');
  assert.equal(helpers.normalizeSuggestionTerm('\uFF33\uFF21\uFF2C\uFF25'),'sale');
  for(const term of ['', ' ', 'x'.repeat(201), 'dress\nblue', 'dress\0'])assert.throws(()=>helpers.validateSuggestionBlacklist(term,'contains'));
  assert.throws(()=>helpers.validateSuggestionBlacklist('dress','regex'));
});
test('blacklisting happens before the suggestion limit, preserving useful alternatives',()=>{
  const products=Array.from({length:8},(_,i)=>({title:i<4?'Dress blocked '+i:'Dress allowed '+i}));
  const suggestions=buildSearchSuggestions('dress',products,[],3,[{term:'blocked',operator:'contains'}]);
  assert.deepEqual(suggestions,['Dress allowed 4','Dress allowed 5','Dress allowed 6']);
  assert.equal(products.length,8);
});
test('rule fixture covers CRUD, fresh reads, disabled rules and normalized duplicates',async()=>{
  const {db,rows}=database();const s=await service(db);
  await s.saveSuggestionBlacklist(shop,form({intent:'create',term:'  SALE ',operator:'contains',isActive:'true'}));
  const id=[...rows.keys()][0];assert.equal((await s.getActiveSuggestionBlacklist(shop))[0].term,'sale');
  await assert.rejects(s.saveSuggestionBlacklist(shop,form({intent:'create',term:'sale',operator:'contains',isActive:'true'})),{code:'P2002'});
  await s.saveSuggestionBlacklist(shop,form({intent:'update',id,term:'blue dress',operator:'exact',isActive:'true'}));
  assert.equal((await s.getActiveSuggestionBlacklist(shop))[0].operator,'exact');
  await s.saveSuggestionBlacklist(shop,form({intent:'toggle',id,isActive:'false'}));assert.equal((await s.getActiveSuggestionBlacklist(shop)).length,0);
  await s.saveSuggestionBlacklist(shop,form({intent:'toggle',id,isActive:'true'}));assert.equal((await s.getActiveSuggestionBlacklist(shop)).length,1);
  await s.saveSuggestionBlacklist(shop,form({intent:'delete',id}));assert.equal((await s.getActiveSuggestionBlacklist(shop)).length,0);
});
test('rule writes are scoped to the authenticated shop and rejected edits preserve old data',async()=>{
  const {db,rows}=database();const s=await service(db);
  for(const term of ['sale','dress'])await s.saveSuggestionBlacklist(shop,form({intent:'create',term,operator:'contains',isActive:'true'}));
  const [id,second]=[...rows.keys()];
  for(const intent of ['update','toggle','delete'])await assert.rejects(s.saveSuggestionBlacklist('other.myshopify.com',form({intent,id,term:'changed',operator:'exact',isActive:'true'})));
  await assert.rejects(s.saveSuggestionBlacklist(shop,form({intent:'update',id:second,term:'sale',operator:'contains',isActive:'true'})),{code:'P2002'});
  assert.equal(rows.get(second).term,'dress');assert.equal((await s.getActiveSuggestionBlacklist('other.myshopify.com')).length,0);
  for(const values of [{intent:'create',term:'',operator:'contains',isActive:'true'},{intent:'toggle',id,isActive:'invalid'},{intent:'unknown',isActive:'true'}])await assert.rejects(s.saveSuggestionBlacklist(shop,form(values)));
  assert.equal(rows.size,2);
});

export async function searchApi(getRules) {
  const products=[{id:'1',title:'Blue Dress',status:'ACTIVE',options:[],tags:[],variantPrices:[]},{id:'2',title:'Red Dress',status:'ACTIVE',options:[],tags:[],variantPrices:[]}];
  return load('app/routes/api.search.jsx',{
    '../services/queryParser.server.js':{parseQuery:async()=>null},
    '../utils/searchColor.js':{selectSearchColorVariant},'../utils/spellingCorrection.js':{spellingCorrection},'../utils/searchSuggestions.js':{buildSearchSuggestions},
    '../services/suggestionBlacklist.server.js':{getActiveSuggestionBlacklist:getRules},'react-router':{data:(v,i)=>Response.json(v,i)},
    '../db.server':{__esModule:true,default:{}},'../services/merchandising.server':{getActivePinningRuleForSearch:async()=>null,getActiveRuleForSearch:async()=>null},
    '../services/meiliClient.server':{__esModule:true,default:{index:()=>({searchForFacetValues:async()=>({facetHits:[]})})}},
    '../services/searchRanking.server.js':{},'../services/filterSettings.server':{},'../services/shopCache.server':{getCached:async()=>({})},'../services/rateLimiter.server':{rateLimit:async()=>true},
    '../services/semanticSearch.server':{semanticSearch:async()=>({hits:products})},
  });
}
test('actual search API filters suggestions, preserves products and reads rules fresh',async()=>{
  let rules=[];let calls=0;
  const route=await searchApi(async requestedShop=>{assert.equal(requestedShop,shop);calls++;return rules;});
  const request=()=>({request:new Request('https://fixture/api/search?'+new URLSearchParams({shop,q:'dress'}))});
  const before=await(await route.loader(request())).json();assert.ok(before.suggestions.includes('Blue Dress'));
  rules=[{term:'blue dress',operator:'exact'}];const response=await route.loader(request());const after=await response.json();
  assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(!after.suggestions.includes('Blue Dress'));assert.ok(after.suggestions.includes('Red Dress'));
  assert.deepEqual(after.products,before.products);assert.equal(calls,2);
});
test('blacklist database failures suppress suggestions without failing product search',async()=>{
  const route=await searchApi(async()=>{throw Error('Database unavailable');});
  const response=await route.loader({request:new Request('https://fixture/api/search?'+new URLSearchParams({shop,q:'dress'}))});
  const result=await response.json();assert.equal(response.status,200);assert.equal(result.products.length,2);assert.deepEqual(result.suggestions,[]);
});
test('admin actions reject duplicates, preserve validation errors and avoid exposing database errors',async()=>{
  const {db}=database();const s=await service(db);
  const route=await load('app/routes/app.search.blacklist.jsx',{'react-router':{},react:{},'@shopify/shopify-app-react-router/server':{boundary:{}},'../shopify.server':{authenticate:{admin:async()=>({session:{shop}})}},'../db.server':{__esModule:true,default:db},'../services/suggestionBlacklist.server.js':s,'../utils/suggestionBlacklist.js':helpers});
  const action=values=>route.action({request:new Request('https://fixture/admin',{method:'POST',body:form(values)})});
  const values={intent:'create',term:'blue',operator:'contains',isActive:'true',shop:'evil.myshopify.com'};
  assert.equal((await action(values)).success,true);assert.ok((await action(values)).error.includes('already exist'));
  assert.ok((await action({...values,term:''})).error.includes('1–200'));
  assert.equal((await route.loader({request:new Request('https://fixture/admin')})).rules.length,1);
  db.searchSuggestionBlacklist.create = async () => { throw Error('Private database connection details'); };
  assert.equal((await action({...values,term:'other'})).error,'Could not save the blacklist rule. Please retry.');
});
