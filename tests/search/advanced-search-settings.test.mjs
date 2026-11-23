import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';
import {transform} from 'esbuild';
import * as schema from '../../app/utils/searchSettings.js';
import * as configuration from '../../app/utils/searchConfiguration.js';
import * as semantic from '../../app/utils/semanticSearch.js';
import * as sku from '../../app/utils/skuSearch.js';
import {readSearchIndexExtras} from '../../app/utils/searchIndexExtras.js';
import * as suggestionText from '../../app/utils/searchSuggestions.js';

const shop='one.myshopify.com',other='two.myshopify.com';
const defaults=schema.DEFAULT_SEARCH_SETTINGS;
const plain=value=>JSON.parse(JSON.stringify(value));
const settings=patch=>schema.validateSearchSettings({...defaults,...patch});
const fields=patch=>defaults.fields.map(field=>({...field,...(patch[field.key]||{})}));
const product=(id,tenant=shop)=>({id:String(id),shop:tenant,status:'ACTIVE',title:'Blue Dress '+id,handle:'dress-'+id,vendor:'Brand',options:[{name:'Color',values:['Blue','Red']}],variantPrices:[{id:'v1',sku:'1517-Blue-4',option1:'Blue',available:true},{id:'v2',sku:'9999-Red-4',option1:'Red',available:false}]});

test('collection names participate in default search without changing title priority',()=>{
 const collectionField=defaults.fields.find(field=>field.key==='collections');
 assert.equal(collectionField.search,true);
 assert.ok(defaults.fields.find(field=>field.key==='title').weight>collectionField.weight);
 const document=configuration.projectConfiguredSearchDocument({...product(1),collection_titles:['Prom Dresses']},defaults);
 const query=configuration.configuredSearchOptions({q:'prom dress'},defaults);
 assert.deepEqual(document.cfp_field_005,['Prom Dresses']);
 assert.ok(query.attributesToSearchOn.includes('cfp_field_005'));
});

test('advanced controls validate types, limits, custom fields and safe paths',()=>{
 assert.deepEqual(settings({}),defaults);
 for(const [key,[,fallback,min,max]]of Object.entries(schema.ADVANCED_SEARCH_FIELDS)){
  assert.throws(()=>settings({[key]:typeof fallback==='boolean'?'true':max+1}));
  if(typeof fallback!=='boolean')assert.equal(settings({[key]:min})[key],min);
 }
 for(const path of ['https://evil.test','//evil.test','/search?q=x','/','/pages/<script>'])assert.throws(()=>settings({searchResultsPath:path}));
 assert.equal(settings({searchResultsPath:'/pages/find-dresses'}).searchResultsPath,'/pages/find-dresses');
 assert.throws(()=>settings({fields:[...defaults.fields,defaults.fields[0]]}));
 assert.throws(()=>settings({fields:fields({sku:{weight:Infinity}})}));
 assert.throws(()=>settings({fields:[{...defaults.fields[0],key:'variantMetafield:*'}]}));
 assert.throws(()=>settings({tokenDelimiters:['ab']}));
 assert.throws(()=>settings({returnedMetafields:['bad key']}));
 assert.equal(configuration.requiresCustomSearchIndex(settings({instantColumns:2,pageSize:10})),false);
 assert.equal(configuration.requiresCustomSearchIndex(settings({stopwords:['the']})),true);
});

test('field transforms are literal, ordered, and independent from result presentation',()=>{
 const rules=[{type:'strip-html'},{type:'trim'},{type:'remove-prefix',value:'Style '},{type:'replace',value:'.*',replacement:' Dress'},{type:'uppercase'}];
 assert.equal(configuration.transformSearchValue('<b>Style blue.*</b>',rules),'BLUE DRESS');
 const config=settings({fields:fields({title:{transforms:[{type:'remove-prefix',value:'Blue '}],indexTransforms:[{type:'lowercase'}]},sku:{delimiter:'-',numeric:true}})});
 const projected=configuration.projectConfiguredSearchDocument(product(1),config);
 assert.equal(projected.title,'Blue Dress 1');
 assert.deepEqual(projected.cfp_field_000,['dress 1']);
 assert.deepEqual(projected.cfp_field_006,[1517,4,9999]);
 assert.equal(configuration.publicSearchProduct(projected,config).title,'Dress 1');
 assert.equal(Object.keys(configuration.publicSearchProduct(projected,config)).some(key=>key.startsWith('cfp')),false);
});

test('unavailable variants do not contribute SKU or option search values',()=>{
 const config=settings({hideUnavailableVariants:true});
 const doc=configuration.projectConfiguredSearchDocument(product(1),config);
 assert.deepEqual(doc.cfp_field_006,['1517-Blue-4']);
 assert.deepEqual(doc.cfp_field_009,['Blue']);
 assert.deepEqual(doc.cfpSkuNormalized,['1517blue4']);
 assert.equal(doc.variantPrices.length,2,'Card selection remains separate from index text');
});

test('selected metafields, delimiters and response whitelist do not expose index internals',()=>{
 const custom={...defaults.fields[0],key:'productMetafield:custom.fabric',delimiter:',',transforms:[],indexTransforms:[{type:'trim'}]};
 const config=settings({fields:[custom],returnedMetafields:['custom.fabric'],tentativeDelimiters:['-']});
 const doc=configuration.projectConfiguredSearchDocument({...product(1),'metafield_custom.fabric':'Silk, Satin','metafield_private.notes':'private'},config);
 assert.deepEqual(doc.cfp_field_000,['Silk','Satin']);
 const result=configuration.publicSearchProduct(doc,config);
 assert.equal(result['metafield_private.notes'],undefined);
 assert.equal(configuration.normalizeSearchTokens('blue - satin-a',config),'blue   satin-a');
 const query=configuration.configuredSearchOptions({q:'silk',filter:['shop = "one.myshopify.com"']},config);
 assert.deepEqual(query.attributesToSearchOn,['cfp_field_000']);
 assert.deepEqual(query.filter,['shop = "one.myshopify.com"']);
});

async function fixture(config=settings({stopwords:['the']}),catalog=Array.from({length:23},(_,i)=>product(i+1)),activeSynonym=false){
 const rows=new Map([[shop,{shop,config:plain(config),updatedAt:1}]]),cache=new Map(),indexes=new Map(),jobs=[],calls=[];
 let clock=1,task=0,fail=false;
 const redis={get:async key=>cache.get(key)??null,set:async(key,value)=>cache.set(key,value),del:async key=>cache.delete(key),incr:async key=>{const value=Number(cache.get(key)||0)+1;cache.set(key,String(value));return value;},eval:async(_script,_n,key,value)=>{cache.set(key,String(Math.max(Number(cache.get(key)||0),Number(value))));}};
 const prisma={searchSetting:{findUnique:async({where})=>rows.has(where.shop)?structuredClone(rows.get(where.shop)):null,upsert:async({where,create})=>{if(!rows.has(where.shop))rows.set(where.shop,{...create,updatedAt:++clock});return rows.get(where.shop);},updateMany:async({where,data})=>{const row=rows.get(where.shop);if(!row||row.updatedAt!==where.updatedAt)return {count:0};rows.set(where.shop,{...row,...structuredClone(data),updatedAt:++clock});return {count:1};}},synonym:{findMany:async({distinct}={})=>distinct?activeSynonym?[{shop}]:[]:activeSynonym?[{word:'gown',synonyms:'dress'}]:[],findFirst:async({where})=>activeSynonym&&where.shop===shop?{id:'synonym'}:null}};
 const queued=async()=>({taskUid:++task});
 prisma.product={findMany:async({where,take})=>catalog.filter(p=>p.shop===where.shop&&(!where.id||p.id>where.id.gt)&&where.OR.some(clause=>p.title.includes(clause.title.contains))).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,take).map(p=>({id:p.id})),count:async({where})=>catalog.filter(p=>p.shop===where.shop&&where.OR.some(clause=>p.title.includes(clause.title.contains))).length};
 let sharedSynonyms={gown:['dress']},sharedFields=['shop','status','id'];const savedSettings=new Map();
 const client={getIndex:async uid=>{if(!indexes.has(uid))throw Object.assign(Error('Missing'),{cause:{code:'index_not_found'}});return {};},createIndex:async uid=>{indexes.set(uid,new Map());return queued();},deleteIndex:async uid=>{calls.push(['retire',uid]);indexes.delete(uid);return queued();},tasks:{getTask:async()=>({status:'succeeded'}),waitForTask:async uid=>{calls.push(['wait',uid]);if(fail)throw Error('engine unavailable');return {status:'succeeded'};}},index:uid=>({
  getSettings:async()=>({filterableAttributes:uid==='products'?sharedFields:['shop','status','id'],sortableAttributes:['priceMin'],rankingRules:['words','typo','proximity','attribute','sort','exactness'],...savedSettings.get(uid)}),
  updateSettings:async value=>{assert.deepEqual(Object.keys(value.typoTolerance||{}).filter(key=>!['enabled','minWordSizeForTypos','disableOnWords','disableOnAttributes'].includes(key)),[]);calls.push(['settings',uid,value]);savedSettings.set(uid,{...savedSettings.get(uid),...plain(value)});return queued();},getSynonyms:async()=>sharedSynonyms,updateSynonyms:async value=>{calls.push(['synonyms',uid,plain(value)]);if(uid==='products')sharedSynonyms=plain(value);return queued();},
  deleteAllDocuments:async()=>{indexes.get(uid).clear();calls.push(['clear',uid]);return queued();},
  addDocuments:async docs=>{for(const p of docs)indexes.get(uid).set(String(p.id),plain(p));return queued();},
  updateDocuments:async docs=>{calls.push(['patch',uid,plain(docs)]);for(const p of docs)indexes.get(uid).set(String(p.id),{...indexes.get(uid).get(String(p.id)),...plain(p)});return queued();},
  deleteDocuments:async ids=>{for(const id of ids)indexes.get(uid).delete(String(id));return queued();},
  getDocuments:async options=>{
   const tenant=JSON.parse(options.filter.match(/shop = ("[^"]+")/)[1]);
   let docs=(uid==='products'?catalog:[...indexes.get(uid).values()]).filter(p=>p.shop===tenant);const ids=options.filter.match(/id IN (\[.*\])/);if(ids){const wanted=JSON.parse(ids[1]);docs=docs.filter(p=>wanted.includes(String(p.id)));}
   const page=docs.slice(options.offset||0,(options.offset||0)+options.limit);
   if(options.fields)calls.push(['read-fields',uid,plain(options.fields)]);
   return {results:plain(options.fields?page.map(doc=>Object.fromEntries(Object.entries(doc).filter(([key])=>options.fields.includes(key)))):page),total:docs.length};
  },search:async(q,options)=>{calls.push(['query',uid,q,plain(options)]);return {hits:[...indexes.get(uid).values()]};},
 })};
 const queue={getJob:async()=>null,add:async(name,data,options)=>jobs.push({name,data:plain(data),options:plain(options)})};
 const mocks={'node:crypto':{createHash,randomUUID},'../db.server.js':{__esModule:true,default:prisma},'./redis.server.js':{__esModule:true,default:redis},'./meiliClient.server.js':{__esModule:true,default:client},'./shopCache.server.js':{getCached:async(_key,read)=>read()},'../utils/searchSettings.js':schema,'../utils/searchConfiguration.js':configuration,'../utils/semanticSearch.js':semantic,'../utils/searchIndexExtras.js':{readSearchIndexExtras},'../utils/skuSearch.js':sku,'../utils/embeddingHold.js':{withHeldEmbeddingsForIndex:async(_index,docs)=>docs}};
 const source=(await fs.readFile('app/services/searchIndex.server.js','utf8')).replace("await import('./queue.server.js')",'injectedQueue');
 const context={module:{exports:{}},exports:{},process:{env:{}},console,injectedQueue:{searchIndexQueue:queue},require:name=>{if(name==='../utils/searchSuggestions.js')return suggestionText;if(!(name in mocks))throw Error(name);return mocks[name];}};
 vm.runInNewContext((await transform(source,{format:'cjs'})).code,context);
 return {service:context.module.exports,rows,cache,indexes,jobs,calls,catalog,extendSharedFilters:()=>sharedFields.push('newCountryField'),fail:()=>{fail=true;},async drain(){let count=0;while(jobs.length){const job=jobs.shift();if(job.name==='SEARCH_INDEX_RETIRE')continue;await context.module.exports.processSearchIndexJob(job.data);if(++count>20)throw Error('Unbounded worker');}}};
}

test('background preparation serves the previous index until every bounded batch is complete',async()=>{
 const f=await fixture();await f.service.scheduleSearchIndex(shop);
 assert.equal((await f.service.getSearchIndexContext(shop)).uid,'products');
 const first=f.jobs.shift();await f.service.processSearchIndexJob(first.data);
 assert.equal(f.rows.get(shop).config._index.processed,20);
 assert.equal((await f.service.getSearchIndexContext(shop)).uid,'products');
 await f.drain();const context=await f.service.getSearchIndexContext(shop);
 assert.equal(context.custom,true);assert.equal(f.indexes.get(context.uid).size,23);
 assert.equal(f.rows.get(shop).config._index.phase,'ready');
 const otherContext=await f.service.getSearchIndexContext(other);assert.equal(otherContext.uid,'products');
 assert.equal(f.calls.find(c=>c[0]==='settings')[2].searchableAttributes[0],'cfp_field_000');
});

test('configured suggestions skip review widget markup before applying the suggestion limit',async()=>{
 const f=await fixture(settings({stopwords:['the']}),[{...product(1),title:'Silver Dress',
  'metafield_reviews.widget':'<link rel="stylesheet" href="https://assets.reviews.io/style.css"><script>document.write("silver")</script>',
  'metafield_custom.color':'Silver','metafield_custom.collection':'Silver Dresses'}]);
 await f.service.scheduleSearchIndex(shop);await f.drain();
 assert.deepEqual(plain(await f.service.configuredSuggestions(shop,'silver',3)),['Silver Dress','Silver','Silver Dresses']);
});

test('default search settings build a private index when a shop has synonyms',async()=>{
 const f=await fixture(settings({}),[product(1),product(2,other)],true);
 await f.service.scheduleSearchIndex(shop);
 await f.drain();
 const own=await f.service.getSearchIndexContext(shop);
 const unrelated=await f.service.getSearchIndexContext(other);
 assert.equal(own.custom,true);
 assert.equal(f.indexes.get(own.uid).size,1);
 assert.equal(unrelated.uid,'products');
});

test('synonym query branches are bounded by words and isolated to the owner',async()=>{
 const f=await fixture(settings({}),[product(1)],true);
 const own=await f.service.prepareConfiguredSearchQueries([{q:'gown',filter:[`shop = "${shop}"`]}]);
 assert.deepEqual(plain(own[0]._cfpSynonymQueries),['dress']);
 assert.equal(own[0].indexUid,'products');
 assert.equal(f.jobs.length,0,'tenant synonym expansion does not require a catalog build');
 const unrelated=await f.service.prepareConfiguredSearchQueries([{q:'gown',filter:[`shop = "${other}"`]}]);
 assert.equal(unrelated[0]._cfpSynonymQueries,undefined);
 const partial=await f.service.prepareConfiguredSearchQueries([{q:'gownish',filter:[`shop = "${shop}"`]}]);
 assert.equal(partial[0]._cfpSynonymQueries,undefined);
});

test('legacy shared synonyms clear only after every owning shop has a complete private index',async()=>{
 const f=await fixture(settings({}),[product(1),product(2,other)],true);
 const first=await f.service.reconcileLegacySynonymIndexes();
 assert.equal(first.pending,1);
 assert.equal(first.scheduled,1);
 assert.equal(f.calls.some(call=>call[0]==='synonyms'&&call[1]==='products'),false);
 await f.drain();
 const last=await f.service.reconcileLegacySynonymIndexes();
 assert.equal(last.pending,0);
 assert.deepEqual(plain(f.calls.find(call=>call[0]==='synonyms'&&call[1]==='products')[2]),{});
 assert.equal((await f.service.getSearchIndexContext(other)).uid,'products');
});

test('migration moves unfinished search builds out of the collection ranking backlog',async()=>{
 const f=await fixture(settings({}),[product(1)],true);
 await f.service.scheduleSearchIndex(shop);
 delete f.rows.get(shop).config._index.build.queue;
 f.jobs.length=0;
 const result=await f.service.reconcileLegacySynonymIndexes();
 assert.equal(result.scheduled,1);
 assert.equal(f.rows.get(shop).config._index.build.queue,'searchIndexQueueV1');
 assert.equal(f.jobs[0].name,'SEARCH_INDEX_BUILD');
});

test('failed preparation retains a complete serving index and never publishes a partial one',async()=>{
 const f=await fixture();await f.service.scheduleSearchIndex(shop);await f.drain();const active=f.rows.get(shop).config._index.active;
 f.rows.get(shop).config.stopwords=['a'];await f.service.scheduleSearchIndex(shop);f.fail();
 await assert.rejects(f.service.processSearchIndexJob(f.jobs.shift().data),/unavailable/);
 assert.equal((await f.service.getSearchIndexContext(shop)).uid,active.uid);
 assert.equal(f.rows.get(shop).config._index.phase,'failed');
});

test('catalog changes restart offset scans and update or delete only that store’s documents',async()=>{
 const f=await fixture();await f.service.scheduleSearchIndex(shop);await f.service.processSearchIndexJob(f.jobs.shift().data);
 f.catalog.shift();f.catalog.push({...product(30),title:'Restocked dress'});
 await f.service.scheduleSearchIndexProducts(shop,['1','30'],8);
 await f.drain();const context=await f.service.getSearchIndexContext(shop),docs=f.indexes.get(context.uid);
 assert.equal(docs.size,23);assert.equal(docs.has('1'),false);assert.equal(docs.get('30').title,'Restocked dress');
 assert.ok(f.calls.filter(c=>c[0]==='clear').length>=2);
 assert.ok(f.calls.some(c=>c[0]==='wait'&&c[1]===8));
});

test('country price completion updates the serving search projection before returning, without rebuilding it',async()=>{
 const f=await fixture();await f.service.scheduleSearchIndex(shop);await f.drain();
 const uid=(await f.service.getSearchIndexContext(shop)).uid,previous=plain(f.indexes.get(uid).get('2'));
 const clears=f.calls.filter(c=>c[0]==='clear').length;
 f.catalog[0].marketPriceMin_IN=13300;f.catalog[0].marketPriceCurrency_IN='INR';
 f.catalog[0].variantPrices[0].marketPrices={IN:{price:13300,currency:'INR'}};
 await f.service.refreshSearchIndexProductPrices(shop,['1'],8);
 assert.equal(f.indexes.get(uid).get('1').marketPriceMin_IN,13300);
 assert.equal(f.indexes.get(uid).get('1').variantPrices[0].marketPrices.IN.price,13300);
 assert.deepEqual(f.indexes.get(uid).get('2'),previous);
 assert.equal(f.calls.filter(c=>c[0]==='clear').length,clears);
 assert.ok(f.jobs.some(j=>j.name==='SEARCH_INDEX_PRODUCTS'),'Durable recovery delta remains queued');
});

test('query policies keep normal collections on the shared index and isolate search field scopes',async()=>{
 const f=await fixture(settings({fields:fields({title:{weight:0},sku:{weight:1,suggest:true}}),smartSkuSearch:true,broadMatch:false}));
 await f.service.scheduleSearchIndex(shop);await f.drain();
 const active=(await f.service.getSearchIndexContext(shop)).uid;
 const result=await f.service.prepareConfiguredSearchQueries([{q:'1517-Blue',filter:[`shop = '${shop}'`]}, {q:'',filter:[`shop = '${shop}'`]}, {q:'',_cfpSearchSurface:true,filter:[`shop = '${shop}'`]}, {q:'dress',filter:[`shop = '${other}'`]}]);
 assert.equal(result[0].indexUid,active);assert.equal(result[0].q,'1517blue');assert.deepEqual(plain(result[0].attributesToSearchOn),['cfpSkuNormalized']);assert.equal(result[0]._cfpSemanticDisabled,true);
 assert.equal(result[1].indexUid,'products');assert.equal(result[2].indexUid,active);assert.equal(result[3].indexUid,'products');
 assert.equal('_cfpSearchSurface' in result[2],false);
});

test('retirement refuses another tenant and retains active indexes',async()=>{
 const f=await fixture();await f.service.scheduleSearchIndex(shop);await f.drain();const uid=(await f.service.getSearchIndexContext(shop)).uid;
 await assert.rejects(f.service.processSearchIndexJob({shop:other,retireUid:uid}),/tenant mismatch/);
 assert.equal((await f.service.processSearchIndexJob({shop,retireUid:uid})).retained,true);
 f.rows.delete(shop);assert.equal((await f.service.processSearchIndexJob({shop,retireUid:uid})).retired,true);assert.equal(f.indexes.has(uid),false);
});

test('separator saves reuse the serving index and patch only matching saved titles',async()=>{
 const f=await fixture(settings({}),[{...product(1),title:'Blue Dress | Prom, Evening'},product(2),{...product(3,other),title:'Foreign | Dress'}],true);
 await f.service.scheduleSearchIndex(shop);await f.drain();const active=(await f.service.getSearchIndexContext(shop)).uid;
 const clears=f.calls.filter(c=>c[0]==='clear').length;
 f.rows.get(shop).config.fields=fields({title:{delimiter:'|',delimiters:[','],indexTransforms:[{type:'trim'}]}});
 await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});await f.drain();
 assert.equal((await f.service.getSearchIndexContext(shop)).uid,active);
 assert.equal(f.indexes.size,1);assert.equal(f.calls.filter(c=>c[0]==='clear').length,clears);
 const patches=f.calls.filter(c=>c[0]==='patch').flatMap(c=>c[2]);assert.deepEqual(patches.map(p=>p.id),['1']);
 assert.deepEqual(patches[0].cfp_field_000,['Blue Dress','Prom','Evening']);
 assert.equal(patches[0].title,undefined);assert.equal(patches[0].variantPrices,undefined);
 assert.equal(f.indexes.get(active).get('1').title,'Blue Dress | Prom, Evening');
 assert.equal(f.rows.get(shop).config._index.lastUpdate.updated,1);
 assert.deepEqual(f.calls.filter(c=>c[0]==='read-fields'&&c[1]==='products').at(-1)[2],['id','shop','status','title']);
});

test('a delimiter-only edit selects candidates from saved DB rather than visiting the whole catalog',async()=>{
 const f=await fixture(settings({}),[{...product(1),title:'Blue, Evening'},product(2)],true);
 await f.service.scheduleSearchIndex(shop);await f.drain();
 const original=configuration.projectConfiguredSearchDocument(product(2),settings({}));
 f.rows.get(shop).config.fields=fields({title:{delimiter:','}});
 assert.deepEqual(plain(f.service.searchRuleCandidates(settings({}),settings({fields:fields({title:{delimiter:','}})}))),{OR:[{title:{contains:','}}]});
 await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});await f.drain();
 const state=f.rows.get(shop).config._index;assert.equal(state.lastUpdate.processed,1);assert.equal(state.lastUpdate.updated,1);
 assert.deepEqual(f.indexes.get(state.active.uid).get('2'),original);
});

test('changing priorities and stopwords updates configuration without reading or writing documents',async()=>{
 const f=await fixture();await f.service.scheduleSearchIndex(shop);await f.drain();const count=f.calls.length;
 f.extendSharedFilters();
 f.rows.get(shop).config.stopwords=['a'];f.rows.get(shop).config.fields=fields({title:{weight:.8}});
 await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});await f.drain();
 assert.equal(f.calls.slice(count).some(c=>c[0]==='patch'||c[0]==='clear'),false);
 assert.equal(f.rows.get(shop).config._index.lastUpdate.processed,0);
 assert.ok(f.calls.slice(count).filter(c=>c[0]==='settings').every(c=>!('filterableAttributes' in c[2])&&!('sortableAttributes' in c[2])),'a rule edit must not copy unrelated country/collection settings and trigger their engine reindex');
});

test('removing separators restores old search values and retries do not start a full build',async()=>{
 const f=await fixture(settings({fields:fields({title:{delimiter:','}})}),[{...product(1),title:'Blue, Evening'}]);
 await f.service.scheduleSearchIndex(shop);await f.drain();const active=(await f.service.getSearchIndexContext(shop)).uid;
 f.rows.get(shop).config.fields=fields({});await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});await f.drain();
 assert.equal((await f.service.getSearchIndexContext(shop)).uid,active);
 assert.deepEqual(f.indexes.get(active).get('1').cfp_field_000,['Blue, Evening']);
 const writes=f.calls.filter(c=>c[0]==='patch').length;
 await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});await f.drain();assert.equal(f.calls.filter(c=>c[0]==='patch').length,writes);
});

test('zero title weight and reversed priorities activate even when engine writes cannot complete',async()=>{
 const f=await fixture();await f.service.scheduleSearchIndex(shop);await f.drain();
 const uid=f.rows.get(shop).config._index.active.uid;
 for(const weights of [{title:0,handle:1},{title:.2,handle:1},{title:1,handle:.1}]){
  const checkpoint=f.calls.length;
  f.rows.get(shop).config.fields=fields(Object.fromEntries(Object.entries(weights).map(([key,weight])=>[key,{weight}])));
  await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});f.fail();await f.drain();
  const state=f.rows.get(shop).config._index;assert.equal(state.phase,'ready');assert.equal(state.active.uid,uid);
  assert.deepEqual(plain(state.lastUpdate),{processed:0,updated:0});
  assert.equal(f.calls.slice(checkpoint).some(c=>['settings','patch','clear','read-fields','wait'].includes(c[0])),false);
  const [query]=await f.service.prepareConfiguredSearchQueries([{q:'godet',filter:[`shop = "${shop}"`]}]);
  assert.equal(query.attributesToSearchOn.includes('cfp_field_000'),weights.title>0);
  assert.equal(query._cfpFieldWeights.find(field=>field.attribute==='cfp_field_001').weight,weights.handle);
  assert.equal(!!query._cfpSemanticDisabled,weights.title===0,'disabled fields cannot leak through stale semantic text');
 }
 const collection=await f.service.prepareConfiguredSearchQueries([{q:'',filter:[`shop = "${shop}"`]}]);
 assert.equal(collection[0].indexUid,'products');assert.equal(collection[0]._cfpFieldWeights,undefined);
});

test('superseding a failed weight save does not schedule a catalog comparison',async()=>{
 const f=await fixture();await f.service.scheduleSearchIndex(shop);await f.drain();
 const before=plain(f.rows.get(shop).config);f.rows.get(shop).config.fields=fields({title:{weight:0},handle:{weight:1}});
 f.rows.get(shop).config._index.update={hash:'failed-weight-save',from:before,config:plain(f.rows.get(shop).config),forceFields:[],forceScan:true,offset:100,cursor:null,applied:true,processed:100,updated:68};
 const stale={data:{shop,hash:'failed-weight-save',incremental:true}};
 f.rows.get(shop).config.fields=fields({title:{weight:.2},handle:{weight:1}});
 const checkpoint=f.calls.length;await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});
 assert.equal(f.rows.get(shop).config._index.update,null);assert.equal(f.rows.get(shop).config._index.phase,'ready');
 assert.equal((await f.service.processSearchIndexJob(stale.data)).superseded,true);await f.drain();
 assert.equal(f.calls.slice(checkpoint).some(c=>['read-fields','patch','settings'].includes(c[0])),false);
});

test('product deltas retain the saved semantic scope across disabling and restoring title search',async()=>{
 const f=await fixture(settings({}),[{...product(1),title:'Original title'}],true);
 await f.service.scheduleSearchIndex(shop);await f.drain();const uid=f.rows.get(shop).config._index.active.uid;
 f.rows.get(shop).config.fields=fields({title:{weight:0}});await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});
 f.catalog[0].title='Changed title';await f.service.scheduleSearchIndexProducts(shop,['1'],7);await f.drain();
 assert.ok(f.indexes.get(uid).get('1').cfpSemanticText.includes('Changed title'));
 const scope={q:'changed',filter:[`shop = "${shop}"`]};
 assert.equal((await f.service.prepareConfiguredSearchQueries([scope]))[0]._cfpSemanticDisabled,true);
 f.rows.get(shop).config.fields=fields({});await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});
 assert.equal((await f.service.prepareConfiguredSearchQueries([scope]))[0]._cfpSemanticDisabled,undefined);
 assert.equal(f.rows.get(shop).config._index.phase,'ready');
});

test('rule saves never bootstrap an absent private index with a full rebuild',async()=>{
 const f=await fixture();await assert.rejects(f.service.scheduleSearchIndex(shop,{allowInitialBuild:false}),/No full rebuild was started/);
 assert.equal(f.jobs.length,0);assert.equal(f.indexes.size,0);
 const synonyms=await fixture(settings({}),[product(1)],true);
 await synonyms.service.scheduleSearchIndex(shop,{allowInitialBuild:false});assert.equal(synonyms.jobs.length,0,'a normal save must not bootstrap a synonym index either');
});

test('multiple separators are literal, longest-first and compatible with existing single separators',()=>{
 const cfg=settings({fields:fields({title:{delimiter:'|',delimiters:[',','||'],indexTransforms:[{type:'trim'}]}})});
 const doc=configuration.projectConfiguredSearchDocument({...product(1),title:'Blue||Evening, Prom|Formal'},cfg);
 assert.deepEqual(doc.cfp_field_000,['Blue','Evening','Prom','Formal']);
 assert.deepEqual(configuration.projectConfiguredSearchDocument({...product(1),title:'Blue - Evening'},settings({fields:fields({title:{delimiter:' - '}})})).cfp_field_000,['Blue','Evening']);
 const numbers=settings({fields:fields({title:{delimiter:'|',delimiters:[','],numeric:true}})});
 assert.deepEqual(configuration.projectConfiguredSearchDocument({...product(1),title:'10|20,XL,30.5'},numbers).cfp_field_000,[10,20,30.5]);
});

test('text patches preserve cached extra fields, dates, and unrelated product data',async()=>{
 const f=await fixture(),before=settings({fields:fields({description:{search:true}}),productDateType:'created'});
 const current=configuration.projectConfiguredSearchDocument({...product(1),title:'Blue, Evening',description:'Saved detailed description'},before);
 current.createdAt=123456;
 const config=settings({...before,fields:before.fields.map(field=>field.key==='title'?{...field,delimiter:','}:field)});
 const patch=f.service.searchRulePatch({...product(1),title:'Blue, Evening',createdAt:999999},current,config,before);
 assert.deepEqual(plain(patch.cfp_field_000),['Blue',' Evening']);
 assert.equal(patch.createdAt,undefined);assert.equal(patch.cfp_field_008,undefined);
 assert.ok(patch.cfpSemanticText.includes('Saved detailed description'));
 assert.equal(patch.variantPrices,undefined);assert.equal(patch.priceMin,undefined);
});

test('rapidly replacing a partially applied rule also repairs values changed by the superseded rule',async()=>{
 const f=await fixture(settings({}),[{...product(1),title:'Blue, Evening'}],true);
 await f.service.scheduleSearchIndex(shop);await f.drain();const active=f.rows.get(shop).config._index.active;
 f.rows.get(shop).config.fields=fields({title:{delimiter:','}});await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});
 const stale=f.jobs.shift();
 // Model a completed engine write whose checkpoint has not yet committed.
 f.indexes.get(active.uid).get('1').cfp_field_000=['Blue',' Evening'];
 f.rows.get(shop).config.fields=fields({});await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});
 assert.equal((await f.service.processSearchIndexJob(stale.data)).superseded,true);
 await f.drain();assert.deepEqual(f.indexes.get(active.uid).get('1').cfp_field_000,['Blue, Evening']);
});

test('failed incremental tasks retry against the same index and supersede a pending full build',async()=>{
 const f=await fixture(settings({}),[{...product(1),title:'Blue, Evening'}],true);
 await f.service.scheduleSearchIndex(shop);await f.drain();const uid=f.rows.get(shop).config._index.active.uid;
 const oldData={shop,hash:'old-full-build'};f.rows.get(shop).config._index.build={uid:'unused',hash:'old-full-build'};
 f.rows.get(shop).config.fields=fields({title:{delimiter:','}});await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});
 assert.equal(f.rows.get(shop).config._index.build,null);
 assert.equal((await f.service.processSearchIndexJob(oldData)).superseded,true);
 assert.equal((await f.service.getSearchIndexStatus(shop)).mode,'incremental');
 await f.drain();assert.equal(f.rows.get(shop).config._index.active.uid,uid);
 assert.equal(f.calls.filter(c=>c[0]==='patch').length,1);
});

test('a full build queued by the old release is converted to a saved-value update',async()=>{
 const f=await fixture(settings({}),[{...product(1),title:'Blue, Evening'}],true);
 await f.service.scheduleSearchIndex(shop);await f.drain();const uid=f.rows.get(shop).config._index.active.uid;
 const row=f.rows.get(shop);row.config.fields=fields({title:{delimiter:','}});
 const requested=createHash('sha256').update(JSON.stringify([shop,configuration.searchIndexConfiguration(row.config)])).digest('hex');
 row.config._index={...row.config._index,requested,build:{uid:'old-partial-build',hash:requested},phase:'building'};
 assert.equal((await f.service.processSearchIndexJob({shop,hash:requested})).convertedToIncremental,true);
 assert.equal(row.config._index.build?.uid,'old-partial-build','fixture mutation uses versioned replacement');
 assert.equal(f.rows.get(shop).config._index.build,null);
 await f.drain();assert.equal(f.rows.get(shop).config._index.active.uid,uid);
 assert.deepEqual(f.indexes.get(uid).get('1').cfp_field_000,['Blue',' Evening']);
});

test('catalog deletions during a multi-batch rule update never clear the serving index or skip shifted rows',async()=>{
 const f=await fixture(settings({}),Array.from({length:150},(_,i)=>product(i+1)),true);
 await f.service.scheduleSearchIndex(shop);await f.drain();const uid=f.rows.get(shop).config._index.active.uid;
 const clears=f.calls.filter(c=>c[0]==='clear').length;
 f.rows.get(shop).config.fields=fields({title:{indexTransforms:[{type:'lowercase'}]}});
 await f.service.scheduleSearchIndex(shop,{allowInitialBuild:false});await f.service.processSearchIndexJob(f.jobs.shift().data);
 f.catalog.shift();await f.service.scheduleSearchIndexProducts(shop,['1'],7);await f.drain();
 assert.equal(f.indexes.get(uid).size,149);
 assert.ok([...f.indexes.get(uid).values()].every(doc=>doc.cfp_field_000[0]===doc.title.toLowerCase()));
 assert.equal(f.calls.filter(c=>c[0]==='clear').length,clears);
});

test('Shopify metadata uses variables, validates identity and rejects incomplete variant data',async()=>{
 const config=settings({fields:[{...defaults.fields[0],key:'variantMetafield:custom.fabric'}]});const calls=[];
 const doc={...product(1),variantPrices:[{id:'1',sku:'test',available:true}]};
 const admin={graphql:async(query,options)=>{calls.push({query,options});return {json:async()=>({data:{product:{id:'gid://shopify/Product/1',variants:{nodes:[{id:'gid://shopify/ProductVariant/1',v0:{type:'single_line_text_field',value:'Silk'}}],pageInfo:{hasNextPage:false}}}}})};}};
 const [result]=await readSearchIndexExtras(admin,[doc],config);
 assert.equal(result.variantPrices[0].searchMetafields['custom.fabric'],'Silk');assert.equal(calls[0].options.variables.v0Namespace,'custom');assert.ok(!calls[0].query.includes('namespace:"custom"'));
 admin.graphql=async()=>({json:async()=>({data:{product:{id:'gid://shopify/Product/2'}}})});
 await assert.rejects(readSearchIndexExtras(admin,[doc],config),/identity mismatch/);
});
