import {merchandisingRuleIds} from "../../app/utils/merchandisingSelection.js";
import * as searchColor from "../../app/utils/searchColor.js";
import * as csvImportReport from '../../app/utils/csvImportReport.js';
import {spellingCorrection} from "../../app/utils/spellingCorrection.js";
import {readyPreparation} from './helpers/prepared-ranking.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { normalizeCondition, validConditions } from '../../app/utils/merchandisingCondition.js';
import * as availableVariants from '../../app/utils/availableVariants.js';
const { matchingAvailableVariants, availableProductIds } = availableVariants;
import * as rankedCollection from '../../app/utils/rankedCollectionPage.js';
import { hydrateCollectionSkus, collectionRankingFields } from '../../app/utils/rankedCollectionPage.js';

async function service(rules = []) {
  const context = { module: {exports:{}}, exports:{}, console, require: () => ({__esModule:true, default:{merchandisingRule:{findMany:async()=>rules}}}) };
  vm.runInNewContext((await transform(await fs.readFile('app/services/merchandising.server.js','utf8'),{format:'cjs'})).code,context);
  return context.module.exports;
}

for (const field of ['Price','Discount','Percent sales','Available','Rating']) {
  test(`${field} preserves zero lower/upper bounds through persistence and edit`, () => {
    const saved = normalizeCondition({action:'Boost',field,minValue:0,maxValue:0,value:''});
    assert.equal(saved.minValue,'0'); assert.equal(saved.maxValue,'0');
    assert.equal(validConditions([saved]),true);
    assert.deepEqual(normalizeCondition(saved),saved);
    assert.equal(validConditions([{action:'Boost',field,minValue:'2',maxValue:'1'}]),false);
  });
}
test('blank and incomplete conditions are rejected; valid tag and date conditions accepted',()=>{
  assert.equal(validConditions([]),false);
  assert.equal(validConditions([{action:'Boost',field:'',value:''}]),false);
  assert.equal(validConditions([{action:'Boost',field:'Tags',value:''}]),false);
  assert.equal(validConditions([{action:'Boost',field:'Tags',value:'Premium'}]),true);
  assert.equal(validConditions([{action:'Boost',field:'Date',dateValue:'2026-10-01 - 2026-10-12'}]),true);
  assert.equal(validConditions([{action:'Boost',field:'Date',dateValue:'2026-10-12 - 2026-10-01'}]),false);
});
test('locale matching excludes French-only rules in English and supports language-region fallback',async()=>{
  const {getActiveRuleForCollection}=await service([{id:'fr',name:'French',collections:[],locales:'fr',conditions:[]}]);
  assert.equal(await getActiveRuleForCollection('fixture','Hydrogen',[],'en'),null);
  assert.equal((await getActiveRuleForCollection('fixture','Hydrogen',[],'fr-CA')).name,'French');
  assert.equal(await getActiveRuleForCollection('fixture','Hydrogen'),null);
});
test('[no tag] applies to untagged customers and excludes tagged customers',async()=>{
  const {getActiveRuleForCollection}=await service([{id:'guest',name:'Untagged',collections:[],customerTags:'[no tag]',conditions:[]}]);
  assert.equal((await getActiveRuleForCollection('fixture','Hydrogen',[])).name,'Untagged');
  assert.equal(await getActiveRuleForCollection('fixture','Hydrogen',['vip']),null);
});
test('SKU Exclude accepts picker SKU|title values and leaves unrelated products',async()=>{
  const {applyMerchandisingRules}=await service();
  const products=[{id:'1',variants:[{sku:'MC16-BLK-08'}]},{id:'2',variants:[{sku:'OTHER'}]}];
  const result=applyMerchandisingRules(products,{conditions:[{action:'Exclude',field:'SKU',value:'MC16-BLK-08|Milk Cooler'}]},'best-selling',null);
  assert.deepEqual(Array.from(result,p=>p.id),['2']);
  assert.ok(collectionRankingFields([{field:'SKU'}],'best-selling').includes('variantPrices'));
});
test('SKU fallback hydrates legacy documents using shop-scoped variant reads',async()=>{
  const products=[{id:'gid://shopify/Product/1',variants:[{id:'v1'}]}];
  await hydrateCollectionSkus(products,{findMany:async({where})=>{assert.equal(where.product.shop,'fixture');return [{productId:products[0].id,id:'v1',sku:'legacy'}];}},'fixture');
  assert.equal(products[0].variants[0].sku,'legacy');
});
test('Date Exclude includes the entire end day and ignores invalid/outside dates',async()=>{
  const {applyMerchandisingRules}=await service();
  const products=[{id:'start',createdAt:Date.parse('2026-10-01T00:00:00Z')},{id:'end',createdAt:Date.parse('2026-10-12T23:59:59Z')},{id:'next',createdAt:Date.parse('2026-10-13T00:00:00Z')},{id:'unknown'}];
  const result=applyMerchandisingRules(products,{conditions:[{action:'Exclude',field:'Date',dateValue:'2026-10-01 - 2026-10-12'}]},'best-selling',null);
  assert.deepEqual(Array.from(result,p=>p.id),['next','unknown']);
});
const product={id:'gid://shopify/Product/1',options:[{name:'Color'},{name:'Size'}],variants:[
  {id:'blue-large',option1:'Blue',option2:'large',available:false},
  {id:'blue-small',option1:'Blue',option2:'small',available:true},
  {id:'black-large',option1:'Black',option2:'large',available:true},
]};
test('availability requires every selected option on the same available variant',()=>{
  assert.equal(matchingAvailableVariants(product,{Color:['Blue'],Size:['large']}).length,0);
  assert.deepEqual(matchingAvailableVariants(product,{Color:['Blue'],Size:['small','large']}).map(v=>v.id),['blue-small']);
  assert.equal(matchingAvailableVariants(product,{}).length,2);
});
test('available-variant matching expands merged values and respects option positions',()=>{
  const p={options:[{name:'Size'},{name:'Color'}],variants:[{id:'1',option1:'large',option2:'Navy',available:true}]};
  assert.equal(matchingAvailableVariants(p,{Color:['Blue'],Size:['large']},[{targetValue:'Blue',sourceValues:['Navy']}]).length,1);
});
test('available product IDs exclude products with only unavailable matching combinations',async()=>{
  const model={findMany:async({where})=>{assert.equal(where.shop,'fixture');assert.equal(where.variants.some.available,true);return [product,{...product,id:'gid://shopify/Product/2',variants:[{option1:'Blue',option2:'large',available:true}]}];}};
  assert.deepEqual(await availableProductIds(model,{shop:'fixture'},{Color:['Blue'],Size:['large']},[]),['2']);
});

async function route(file,mocks){
 const context={module:{exports:{}},exports:{},Response,URL,console,require:name=>{
      if (name === "../utils/merchandisingSelection.js") return {merchandisingRuleIds};
   if(name==='../utils/csvImportReport.js')return csvImportReport;
   if(name==='../services/merchandisingImport.server.js')return {};
    if (name === "../utils/searchColor.js") return searchColor;
    if (name === "../services/searchRanking.server.js" || name === "../services/searchPicker.server.js") return {};
   if(name === "../utils/spellingCorrection.js")return {spellingCorrection};
   if(name in mocks)return mocks[name];
   if(name==='../services/shopCache.server.js')return {invalidateShop:async()=>{}};
   if(name==='../services/collectionPreparation.server.js')return readyPreparation({index:mocks['../services/meiliClient.server'].default.index('products'),prisma:mocks['../db.server'].default,arrange:mocks['../services/merchandising.server'].applyMerchandisingRules});
   if(name==='../utils/merchandisingCondition.js')return {normalizeCondition,validConditions};
   if(name.startsWith('../components/')||['react','react-router','@shopify/app-bridge-react'].includes(name))return {};
   throw Error('Unexpected import '+name);
 }};
 vm.runInNewContext((await transform((await fs.readFile(file,'utf8')).replace('await import("../services/shopCache.server")','({invalidateShop: async()=>{}})').replace('await import("../services/queryParser.server.js")','({parseQuery:()=>null})'),{loader:'jsx',format:'cjs'})).code,context);
 return context.module.exports;
}
test('create/edit validation runs before database writes and numeric persistence survives edit',async()=>{
 const calls=[];
 const db={merchandisingRule:{create:async arg=>{calls.push(arg);return arg.data;},update:async arg=>{calls.push(arg);return arg.data;}}};
 const {action}=await route('app/routes/app.collections.merchandising.jsx',{'../shopify.server':{authenticate:{admin:async()=>({session:{shop:'fixture'}})}},'../db.server':{__esModule:true,default:db}});
 const send=(actionType,conditions)=>action({request:new Request('https://fixture/app',{method:'POST',body:new URLSearchParams({actionType,name:'Range',id:'rule',conditions:JSON.stringify(conditions)})})});
 assert.equal((await send('createRule',[{action:'Boost',field:'',value:''}])).status,400);
 assert.equal(calls.length,0);
 for(const intent of ['createRule','editRule']){
  assert.equal((await send(intent,[{action:'Boost',field:'Price',minValue:0,maxValue:1000}])).status,200);
  assert.equal(calls.at(-1).data.conditions.create[0].minValue,'0');
  assert.equal(calls.at(-1).data.conditions.create[0].maxValue,'1000');
 }
 assert.ok(calls.at(-1).data.conditions.deleteMany);
});

test('manual pin export and batch import preserve order and images; legacy image fallback supports URL strings',async()=>{
 const source=await fs.readFile('app/components/merchandising/ExportCollectionPinsModal.jsx','utf8');
 let exported;
 const context={allRules:[{id:'pins',collections:['Smart Watch'],products:[{id:'gid://shopify/Product/1',title:'One',image:'one.jpg'},{id:'gid://shopify/Product/2',title:'Two',image:'two.jpg'}]}],selectedRuleIds:['pins'],selectedFields:['Products','Brief','CollectionTitles'],Papa:{unparse:rows=>{exported=rows;return 'csv';}},Blob,URL:{createObjectURL:()=>''},document:{createElement:()=>({setAttribute(){},style:{},click(){}}),body:{appendChild(){},removeChild(){}}},onClose(){}};
 vm.runInNewContext(source.slice(source.indexOf('  const extractNumericId'),source.indexOf('\n  return ('))+'\nhandleExport();',context);
 const products=JSON.parse(exported[0].Products);
 assert.deepEqual(products.map(p=>p.ImageUrl),['one.jpg','two.jpg']);
 const calls=[];
 const db={product:{findMany:async()=>[1,2,3].map(id=>({id:'gid://shopify/Product/'+id,title:String(id),images:['fallback.jpg']}))},collection:{findMany:async()=>[{id:'gid://shopify/Collection/1',title:'Smart Watch'}]},pinnedProductRule:{upsert:async arg=>calls.push(arg)}};
 const {action}=await route('app/routes/api.import-pins-batch.jsx',{'../shopify.server':{authenticate:{admin:async()=>({session:{shop:'fixture'}})}},'../db.server':{__esModule:true,default:db}});
 const response=await action({request:new Request('https://fixture/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:[{externalId:'pins',collectionTitles:['Smart Watch'],products:[...products,{Id:'3'}]}]})})});
 assert.equal((await response.json()).imported,1);
 assert.deepEqual(Array.from(calls[0].create.products,p=>p.image),['one.jpg','two.jpg','fallback.jpg']);
 assert.deepEqual(Array.from(calls[0].create.products,p=>p.id),['gid://shopify/Product/1','gid://shopify/Product/2','gid://shopify/Product/3']);
});

test('filter endpoint hides unavailable combinations before pagination, reports correct total, and respects the disabled setting',async()=>{
 let enabled=true;
 const options=[{name:'Color',values:['Blue','Black']},{name:'Size',values:['large','small']}];
 const docs=[1,2,3].map(id=>({id:String(id),title:'Product '+id,handle:'p'+id,shop:'fixture',status:'ACTIVE',priceMin:10,images:[],options,
  variantPrices:id===1?product.variants:[{id:'v'+id,option1:'Blue',option2:'large',available:true,price:10},{id:'sold'+id,option1:'Black',option2:'small',available:false,price:10}]}));
 const select=query=>{
  const eligibility=(query.filter||[]).find(f=>typeof f==='string'&&f.startsWith('id IN'));
  const ids=eligibility?JSON.parse(eligibility.slice(6)):null;
  const matches=docs.filter(p=>!ids||ids.includes(p.id));
  return {hits:matches.slice(query.offset||0,(query.offset||0)+(query.limit??25)),totalHits:matches.length,estimatedTotalHits:matches.length,facetDistribution:{}};
 };
 const index={getFilterableAttributes:async()=>['id'],search:async(_q,query)=>select(query),getDocument:async id=>docs.find(p=>p.id===id)};
 const services=await service();
 const cache=new Map();
 const {loader}=await route('app/routes/api.filter.jsx',{
  'react-router':{data:(value,init)=>Response.json(value,init)},
  '../utils/availableVariants.js':availableVariants,'../utils/rankedCollectionPage.js':rankedCollection,
  '../db.server':{__esModule:true,default:{product:{findMany:async()=>docs.map(p=>({...p,id:'gid://shopify/Product/'+p.id,variants:p.variantPrices}))}}},
  '../services/merchandising.server':{...services,getActiveRuleForCollection:async()=>null,getActivePinningRuleForCollection:async()=>null},
  '../services/filterSettings.server':{},'../shopify.server':{},'../services/rateLimiter.server':{rateLimit:async()=>true},
  '../services/meiliClient.server':{__esModule:true,default:{index:()=>index,tasks:{}}},
  '../services/semanticSearch.server':{semanticMultiSearch:async queries=>({results:queries.map(select)})},
  '../services/shopCache.server':{getCached:async(key,fn)=>key.startsWith('globalSettings:')?{hideUnavailableVariantsWhenSelected:enabled}:key.startsWith('mergedValues:')?[]:key.startsWith('filterGroup:')?{resolvedCollectionId:'gid://shopify/Collection/1',resolvedCollectionTitle:'Hydrogen',activeGroupFilters:[]}:fn()},
  '../services/collectionBestSelling.server.js':{getCollectionBestSellingState:async()=>({status:'ready',ids:['1','2','3']})},
  '../utils/collectionPage.js':{},
  '../services/collectionRankingSession.server.js':{collectionRankingFingerprint:()=>'',getCollectionRankingSession:async()=>null,saveCollectionRankingSession:async(_shop,_fp,ids,_time,metadata)=>({ids,metadata,token:'fixture'})},
 });
 const load=async page=>{const response=await loader({request:new Request('https://fixture/api/filter?shop=fixture&collectionHandle=hydrogen&option_Color=Blue&option_Size=large&limit=1&page='+page)});assert.equal(response.status,200);return response.json();};
 for(const page of [1,2]){
  const response=await load(page);
  assert.equal(response.totalCount,2);
  assert.equal(response.products.length,1);
  assert.equal(response.products[0].id,'gid://shopify/Product/'+(page+1));
  assert.ok(response.products[0].variants.every(v=>v.available===true));
  assert.deepEqual(response.products[0].options[0].values,['Blue']);
 }
 enabled=false;
 const disabled=await load(1);
 assert.equal(disabled.totalCount,3);
 assert.equal(disabled.products[0].id,'gid://shopify/Product/1');
 assert.ok(disabled.products[0].variants.some(v=>v.available===false));
});
