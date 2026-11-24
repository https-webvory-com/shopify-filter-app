import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {normalizeManualValues,normalizeManualFacetConfig,normalizeManualFacetFilter} from '../../app/utils/manualFacetValues.js';
import {normalizeProductTitleFilter} from '../../app/utils/productTitleFilter.js';
import {collectionConfiguration,visibleCollectionFacets} from '../../app/utils/collectionBootstrap.js';
import {packCollectionResponse} from '../../app/utils/collectionResponse.js';
import {facetValueKey} from '../../app/utils/facetNormalization.js';

test('manual values preserve text, commas, order, duplicates and supported legacy list shapes',()=>{
 const values=Object.freeze([' Red ','Black, White','Red','']);
 assert.deepEqual(normalizeManualValues(values),values);assert.notEqual(normalizeManualValues(values),values);
 for(const raw of [null,undefined,''])assert.deepEqual(normalizeManualValues(raw),[]);
 for(const raw of ['Red, "Black, White", Red','["Red","Black, White","Red"]','Red\n"Black, White"\r\nRed'])assert.deepEqual(normalizeManualValues(raw),['Red','Black, White','Red']);
 assert.deepEqual(normalizeManualValues('"Said ""Red""", Blue'),['Said "Red"','Blue']);
 for(const raw of [{value:'Red'},true,123,['Red',null],['Red',123],'["Red",123]','"unclosed'])assert.throws(()=>normalizeManualValues(raw));
 const config=Object.freeze({manualValues:values,prefix:'Shade_',useManualValues:true,advanced:{desktopSearchBox:true}});
 const normalized=normalizeManualFacetConfig(config,{strict:true});assert.deepEqual(normalized,config);assert.equal(normalized.advanced,config.advanced);
 const invalid=normalizeManualFacetConfig({manualValues:{value:'Red'},useManualValues:true});assert.deepEqual(invalid.manualValues,[]);assert.equal(invalid.manualValuesInvalid,true);
 assert.equal(normalizeManualFacetConfig(invalid).manualValuesInvalid,true,'repeated reads retain the invalid allow-list marker');
});

test('API and saved bootstrap normalize legacy lists without changing stored configuration or facets',()=>{
 const filter={filterType:'tag',isEnabled:true,config:JSON.stringify({manualValues:'Red, "Black, White"',useManualValues:true,advanced:{desktopSearchBox:true}})};
 const before=JSON.stringify(filter),payload={settings:[filter],products:[],facets:{tags:[{value:'Red',count:2},{value:'Black, White',count:1},{value:'Green',count:3}]}};
 const normalized=normalizeManualFacetFilter(filter);
 assert.deepEqual(normalized.config.manualValues,['Red','Black, White']);assert.equal(JSON.stringify(filter),before);
 assert.deepEqual(collectionConfiguration(payload).configuration.settings[0].config.manualValues,['Red','Black, White']);
 assert.deepEqual(visibleCollectionFacets(payload.facets,[filter]).tags,payload.facets.tags.slice(0,2));
 assert.ok(packCollectionResponse(payload).cfpTransport);assert.equal(JSON.stringify(filter),before);
});

async function actionFixture(){
 const source=await fs.readFile('app/routes/app.filters.groups.$id.jsx','utf8'),ast=ts.createSourceFile('route.jsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
 const action=ast.statements.find(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>d.name.getText(ast)==='action')).declarationList.declarations[0].initializer.getText(ast);
 const writes=[],invalidations=[];
 const context={exports:{},console,normalizeManualFacetConfig,normalizeProductTitleFilter,
  authenticate:{admin:async()=>({session:{shop:'tenant.myshopify.com'}})},
  prisma:{filterGroup:{findFirst:async({where})=>{assert.equal(where.shop,'tenant.myshopify.com');return {id:'group'};}},filterGroupItem:{findFirst:async()=>null,create:async args=>writes.push(args.data),update:async args=>writes.push(args.data)}},
  data:(value,init)=>Response.json(value,init),invalidateShop:async shop=>invalidations.push(shop)};
 vm.runInNewContext(ts.transpileModule('exports.action='+action,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 const send=async fields=>context.exports.action({request:new Request('https://fixture/filter',{method:'POST',body:new URLSearchParams(fields)}),params:{id:'group'}});
 return {writes,invalidations,send};
}

for(const intent of ['addFilter','updateFilter'])test(`${intent} validates and canonicalizes manual values before writing`,async()=>{
 const f=await actionFixture(),fields={intent,filterId:'filter',filterType:'vendor',label:'Brand'};
 for(const manualValues of [{value:'Red'},['Red',false],123]){
  const response=await f.send({...fields,config:JSON.stringify({manualValues})});assert.equal(response.status,400);assert.equal((await response.json()).success,false);
 }
 assert.equal(f.writes.length,0);assert.equal(f.invalidations.length,0);
 assert.equal((await f.send({...fields,config:'{bad'})).status,400);
 for(const manualValues of [['Red','Black, White'],'Red, "Black, White"']){
  const response=await f.send({...fields,config:JSON.stringify({manualValues,useManualValues:true,custom:'preserved'})});assert.equal(response.success,true);
  assert.deepEqual(f.writes.at(-1).config.manualValues,['Red','Black, White']);assert.equal(f.writes.at(-1).config.custom,'preserved');
 }
 assert.equal(f.invalidations.length,2);
});

test('filter import validates every manual list before any write, then saves supported legacy values',async()=>{
 const f=await actionFixture();
 const filter={filterType:'vendor',label:'Brand',config:{manualValues:'Red, Blue',useManualValues:true}};
 const bad=await f.send({intent:'importFilters',filters:JSON.stringify([filter,{...filter,config:{manualValues:{value:'Red'}}}])});
 assert.equal(bad.status,400);assert.equal(f.writes.length,0);assert.equal(f.invalidations.length,0);
 const good=await f.send({intent:'importFilters',filters:JSON.stringify([filter])});assert.equal(good.success,true);assert.deepEqual(f.writes[0].config.manualValues,['Red','Blue']);
});

test('the actual remote facet-search handler keeps saved manual arrays unchanged and tolerates malformed hits',async()=>{
 const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
 const handler=source.slice(source.indexOf('    // Search input for all filter types'),source.indexOf('    // View more toggle'));
 let listener,timer,renders=0;const errors=[];
 const config=Object.freeze({useManualValues:true,manualValues:Object.freeze(['Red','Black, White'])});
 const empty={style:{}},wrapper={querySelectorAll:()=>[],querySelector:selector=>selector==='.cfp-empty-state'?empty:null};
 const input={value:'red',dataset:{inputName:'option-Color'},closest:()=>wrapper,addEventListener:(_name,fn)=>{listener=fn;}};
 const context={facetValueKey,filterRoots:[{querySelectorAll:()=>[input]}],window:{location:{search:''}},document:{activeElement:null},shop:'tenant',collectionHandle:'prom',collectionId:null,API_DOMAIN:'https://fixture',URLSearchParams,
  cfpLastSettings:[{filterType:'option',filterKey:'Color',config}],cfpLastFacets:{options:{Color:[{value:'Blue',count:1}]}},cfpLastTotalCount:3,cfpCountsPending:false,
  fetch:async()=>({json:async()=>({facetHits:[{value:'Red',count:2},{value:'Green',count:1},{value:null},null]})}),
  setTimeout:fn=>{timer=fn;return 1;},clearTimeout:()=>{},renderFilterSidebar:()=>{renders++;},console:{error:(...args)=>errors.push(args)}};
 vm.runInNewContext(handler,context);listener();await timer();
 assert.deepEqual(errors,[]);assert.equal(renders,1);assert.deepEqual(config.manualValues,['Red','Black, White']);
 assert.deepEqual(context.cfpLastFacets.options.Color.map(v=>v.value),['Blue','Red','Green']);
 const shared=source.split('/* CFP_MANUAL_VALUES_START */')[1].split('/* CFP_MANUAL_VALUES_END */')[0],browser={};vm.runInNewContext(shared,browser);
 assert.deepEqual(Array.from(browser.normalizeManualValues('Red, "Black, White"')),['Red','Black, White']);
});
