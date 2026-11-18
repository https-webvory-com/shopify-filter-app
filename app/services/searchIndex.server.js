import {createHash,randomUUID} from 'node:crypto';
import prisma from '../db.server.js';
import redis from './redis.server.js';
import client from './meiliClient.server.js';
import {getCached} from './shopCache.server.js';
import {DEFAULT_SEARCH_SETTINGS,validateSearchSettings} from '../utils/searchSettings.js';
import {searchIndexConfiguration,requiresCustomSearchIndex,projectConfiguredSearchDocument,enabledSearchFields,searchFieldName,configuredSearchOptions,normalizeSearchTokens} from '../utils/searchConfiguration.js';
import {semanticEmbedderSettings} from '../utils/semanticSearch.js';
import {readSearchIndexExtras} from '../utils/searchIndexExtras.js';
import {isProductCodeQuery} from '../utils/skuSearch.js';
import {withHeldEmbeddingsForIndex} from '../utils/embeddingHold.js';
import {cleanSuggestionText} from '../utils/searchSuggestions.js';

const validShop=shop=>/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop||'');
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const identity=(shop,config)=>hash([shop,searchIndexConfiguration(config)]);
const hasActiveSynonyms=async shop=>!!await prisma.synonym.findFirst({where:{shop,isActive:true},select:{id:true}});
const stateOf=row=>row?.config?._index||{};
const revisionKey=shop=>'searchIndexRevision:'+shop;
const sourceRevisionKey=shop=>'searchIndexSourceRevision:'+shop;
const sourceTaskKey=shop=>'searchIndexSourceTask:'+shop;
export const resetSearchIndexContext=shop=>redis.incr(revisionKey(shop));
const wait=async task=>{const done=await client.tasks.waitForTask(task.taskUid,{timeout:120000,interval:250});if(done.status!=='succeeded')throw Error('Search index operation failed: '+(done.error?.code||done.status));return done;};
const meiliErrorCode=error=>error?.cause?.code||error?.code;

async function changeState(shop,change){
 for(let attempt=0;attempt<5;attempt++){
  const row=await prisma.searchSetting.findUnique({where:{shop}});if(!row)return null;
  const state=change(stateOf(row),validateSearchSettings(row.config));if(!state)return null;
  const result=await prisma.searchSetting.updateMany({where:{shop,updatedAt:row.updatedAt},data:{config:{...row.config,_index:state}}});
  if(result.count){await redis.incr(revisionKey(shop));return state;}
 }
 throw Error('Search settings changed during index preparation; retry.');
}
async function enqueue(name,data,id,priority=30,delay=0){
 const {searchIndexQueue}=await import('./queue.server.js');
 const existing=await searchIndexQueue.getJob(id);
 if(existing){const state=await existing.getState();if(state==='failed'){await existing.retry('failed');return;}if(state!=='completed')return;await existing.remove();}
 await searchIndexQueue.add(name,data,{jobId:id,priority,delay,attempts:5,backoff:{type:'exponential',delay:10000},removeOnComplete:true});
}
export async function retireSearchIndexes(shop,uids){
 if(!validShop(shop))return;
 for(const uid of [...new Set(uids.filter(Boolean))])if(uid.startsWith('cfp_search_'+hash(shop).slice(0,16)+'_'))await enqueue('SEARCH_INDEX_RETIRE',{shop,retireUid:uid},'search-retire-'+hash([shop,uid]),40,7200000);
}
export async function syncConfiguredSearchSynonyms(shop,dictionary){
 const row=await prisma.searchSetting.findUnique({where:{shop}}),state=stateOf(row);
 for(const uid of [...new Set([state.active?.uid,state.build?.initialized&&state.build.uid].filter(Boolean))])await wait(await client.index(uid).updateSynonyms(dictionary));
 await resetSearchIndexContext(shop);
}
export async function scheduleSearchIndex(shop,{allowInitialBuild=true}={}){
 if(!validShop(shop))throw Error('Invalid shop');
 const row=await prisma.searchSetting.findUnique({where:{shop}});if(!row)return;
 const config=validateSearchSettings(row.config),requested=identity(shop,config),previous=stateOf(row);
 if(previous.active?.uid){
  if(previous.active.hash===requested&&!previous.update){
   await changeState(shop,(state,current)=>identity(shop,current)!==requested?null:{...state,phase:'ready',requested,build:null,error:null});
   if(previous.build?.uid)await retireSearchIndexes(shop,[previous.build.uid]);
   return;
  }
  const from=validateSearchSettings(previous.update?.from||previous.active.config);
  const interrupted=previous.update?.config&&validateSearchSettings(previous.update.config);
  const forceFields=[...new Set([...(previous.update?.forceFields||[]),...(interrupted?interrupted.fields.filter(field=>changesField(field,from.fields.find(old=>old.key===field.key),from,interrupted)).map(field=>field.key):[])])];
  const update=previous.update?.hash===requested?previous.update:{hash:requested,config,from,forceFields,forceScan:!!previous.update,offset:0,cursor:null,processed:0,updated:0};
  await changeState(shop,(state,current)=>identity(shop,current)!==requested?null:{...state,phase:'queued',requested,build:null,update,error:null,processed:update.processed,total:null});
  await enqueue('SEARCH_INDEX_BUILD',{shop,hash:requested,incremental:true},'search-patch-'+hash([shop,requested,update.offset,update.cursor]));
  if(previous.build?.uid)await retireSearchIndexes(shop,[previous.build.uid]);
  return;
 }
 if(!allowInitialBuild){
  if(requiresCustomSearchIndex(config))throw Object.assign(Error('Search setup is required before adding this rule. No full rebuild was started.'),{code:'SEARCH_INDEX_SETUP_REQUIRED'});
  return;
 }
 if(!requiresCustomSearchIndex(config)&&!await hasActiveSynonyms(shop)){
  await changeState(shop,(_state,current)=>identity(shop,current)!==requested?null:{phase:'ready',requested,active:null,processed:0,total:0});
  await retireSearchIndexes(shop,[previous.active?.uid,previous.build?.uid]);return;
 }
 if(previous.active?.hash===requested){await changeState(shop,(state,current)=>identity(shop,current)!==requested?null:{...state,phase:'ready',requested,build:null,error:null});return;}
 const build=previous.build?.hash===requested?{...previous.build,queue:'searchIndexQueueV1'}:{uid:'cfp_search_'+hash(shop).slice(0,16)+'_'+randomUUID().replaceAll('-',''),hash:requested,offset:0,initialized:false,queue:'searchIndexQueueV1'};
 await changeState(shop,(state,current)=>identity(shop,current)!==requested?null:{...state,phase:'queued',requested,build,error:null,processed:build.offset,queuedAt:Date.now()});
 await enqueue('SEARCH_INDEX_BUILD',{shop,hash:requested},'search-build-'+hash([shop,requested,build.offset]));
 if(previous.build?.uid!==build.uid)await retireSearchIndexes(shop,[previous.build?.uid]);
}
// Move previously saved synonym owners off the shared index in bounded batches.
// The shared dictionary is cleared only after every owner has a complete
// private index, so a worker restart cannot strand a merchant mid-migration.
export async function reconcileLegacySynonymIndexes(){
 const owners=await prisma.synonym.findMany({where:{isActive:true},distinct:['shop'],select:{shop:true}});
 let pending=0,scheduled=0;
 for(const {shop} of owners){
  if(!validShop(shop))continue;
  const row=await prisma.searchSetting.findUnique({where:{shop}}),state=stateOf(row);
  if(state.active?.uid)continue;
  pending++;
  if(scheduled>=10||state.build?.queue==='searchIndexQueueV1'&&state.phase!=='failed')continue;
  await prisma.searchSetting.upsert({where:{shop},create:{shop,config:DEFAULT_SEARCH_SETTINGS},update:{}});
  await scheduleSearchIndex(shop);
  scheduled++;
 }
 if(!pending){
  const taskKey='legacySharedSynonymResetTask';
  const priorUid=await redis.get(taskKey);
  if(priorUid){
   const prior=await client.tasks.getTask(Number(priorUid));
   if(prior.status==='failed'){await redis.del(taskKey);throw Error('Shared synonym cleanup failed: '+(prior.error?.code||'unknown'));}
   if(prior.status!=='succeeded')return {owners:owners.length,pending,scheduled,cleanupPending:true};
   await redis.del(taskKey);
  }
  const shared=client.index('products');
  if(Object.keys(await shared.getSynonyms()).length){
   const task=await shared.updateSynonyms({});
   await redis.set(taskKey,String(task.taskUid),'EX',86400);
  }
 }
 return {owners:owners.length,pending,scheduled};
}
export async function getSearchIndexStatus(shop){
 const state=stateOf(await prisma.searchSetting.findUnique({where:{shop}}));
 return {phase:state.phase||'default',mode:state.update?'incremental':'initial',updated:state.update?.updated||0,processed:state.processed||0,total:state.total??null,error:state.error?(state.update?'Search rule update failed. Existing search remains available. Save again to retry.':'Search index preparation failed. Save again to retry.'):null,active:!!state.active,updatedAt:state.updatedAt||null};
}
export async function getSearchIndexContext(shop){
 if(!validShop(shop))return {uid:'products',settings:null,custom:false};
 const revision=await redis.get(revisionKey(shop))||'0';
 return getCached('searchIndexContext:'+shop+':'+revision,async()=>{
  const row=await prisma.searchSetting.findUnique({where:{shop}});if(!row)return {uid:'products',settings:null,custom:false,layout:'fullscreen'};
  const desired=validateSearchSettings(row.config),active=stateOf(row).active;
  const synonymRules=await prisma.synonym.findMany({where:{shop,isActive:true},select:{word:true,synonyms:true}});
  // A partial build never replaces a complete serving index.
  if(active?.uid&&active.config){const prepared=validateSearchSettings(stateOf(row).update?.applied?desired:active.config);return {uid:active.uid,settings:{...desired,...Object.fromEntries(Object.keys(searchIndexConfiguration(prepared)).map(key=>[key,prepared[key]]))},layout:desired.instantLayout,custom:true,revision,synonymRules};}
  return {uid:'products',settings:requiresCustomSearchIndex(desired)?null:desired,layout:desired.instantLayout,custom:false,revision,synonymRules};
 },15);
}
export function searchQueryShop(query){
 for(const filter of [query.filter||[]].flat(Infinity))if(typeof filter==='string'){
  const match=filter.match(/^\s*shop\s*=\s*(?:"([a-z0-9-]+\.myshopify\.com)"|'([a-z0-9-]+\.myshopify\.com)')\s*$/i);if(match)return match[1]||match[2];
 }
 return null;
}
export async function prepareConfiguredSearchQueries(queries){
 const contexts=new Map();
 for(const query of queries){const shop=searchQueryShop(query);if(shop&&(query.q?.trim()||query._cfpSearchSurface)&&!contexts.has(shop))contexts.set(shop,getSearchIndexContext(shop));}
 const prepared=[];
 for(const query of queries){
  const shop=searchQueryShop(query),context=shop&&(query.q?.trim()||query._cfpSearchSurface)?await contexts.get(shop):null;
  let next=context?.custom?configuredSearchOptions(query,context.settings):{...query,...(context?.settings?{matchingStrategy:context.settings.broadMatch?'last':'all'}:{})};
  if(context?.custom&&context.settings.smartSkuSearch&&isProductCodeQuery(query.q)&&enabledSearchFields(context.settings).some(f=>f.key==='sku'))next={...next,q:String(query.q).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''),attributesToSearchOn:['cfpSkuNormalized'],_cfpSmartSku:true};
  if(context?.settings?.broadMatch===false||context?.custom&&!enabledSearchFields(context.settings).length)next={...next,_cfpSemanticDisabled:true};
  const alternatives=new Set();
  if(!next._cfpSmartSku&&query.q?.trim())for(const rule of context?.synonymRules||[]){
   const terms=[rule.word,...rule.synonyms.split(',')].map(t=>t.trim().toLowerCase()).filter(Boolean);
   for(const term of terms){
    const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pattern=new RegExp('(^|[^\\p{L}\\p{N}_])'+escaped+'(?=$|[^\\p{L}\\p{N}_])','giu');
    if(!pattern.test(next.q))continue;
    for(const replacement of terms)if(replacement!==term){pattern.lastIndex=0;alternatives.add(next.q.replace(pattern,(_match,prefix)=>prefix+replacement));}
   }
  }
  alternatives.delete(next.q);
  if(alternatives.size>32)throw Error('Too many matching synonym alternatives');
  const {_cfpSearchSurface,...clean}=next;prepared.push({...clean,indexUid:context?.uid||query.indexUid||'products',...(alternatives.size?{_cfpSynonymQueries:[...alternatives]}:{})});
 }
 return prepared;
}
export async function configuredSuggestions(shop,query,limit,filter=[]){
 const context=await getSearchIndexContext(shop);if(!context.custom)return null;
 const fields=enabledSearchFields(context.settings,'suggest');if(!fields.length||!query.trim()||!limit)return [];
 const names=fields.map(f=>searchFieldName(f.index)),options=configuredSearchOptions({q:query,filter:[`shop = ${JSON.stringify(shop)}`,"status = 'ACTIVE'",...filter],limit:Math.min(limit+10,30),attributesToRetrieve:names},context.settings,{kind:'suggest'});
 const {q,...params}=options;
 const result=await client.index(context.uid).search(q,params);
 const words=q.toLowerCase().split(/\s+/).filter(Boolean),values=[];
 for(const product of result.hits||[])for(const field of names)for(const value of product[field]||[]){const text=cleanSuggestionText(String(value));if(text&&words.some(word=>text.toLowerCase().includes(word)))values.push(text);}
 return [...new Set(values)].slice(0,limit);
}
async function indexSettings(config){
 const base=await client.index('products').getSettings();
 const names=enabledSearchFields(config).map(f=>searchFieldName(f.index));
 const allNames=[...names,...enabledSearchFields(config,'suggest').map(f=>searchFieldName(f.index)),'cfp_no_search_fields',...(config.smartSkuSearch?['cfpSkuNormalized']:[])];
 const skuFields=enabledSearchFields(config).filter(field=>field.key==='sku').map(field=>searchFieldName(field.index));
 const disabledTypoFields=[...new Set([...(base.typoTolerance?.disableOnAttributes||[]).filter(field=>allNames.includes(field)),...(config.smartSkuSearch?[]:skuFields)])];
 const settings={searchableAttributes:[...new Set(allNames)],filterableAttributes:base.filterableAttributes||[],sortableAttributes:base.sortableAttributes||[],rankingRules:base.rankingRules||['words','typo','proximity','attribute','sort','exactness'],pagination:base.pagination||{maxTotalHits:100000},faceting:base.faceting||{maxValuesPerFacet:100000},stopWords:config.stopwords,separatorTokens:config.tokenDelimiters,nonSeparatorTokens:config.tentativeDelimiters,typoTolerance:{...(base.typoTolerance||{}),disableOnAttributes:disabledTypoFields,...(config.smartSkuSearch?{minWordSizeForTypos:{oneTypo:3,twoTypos:8}}:{})}};
 if(names.length&&Object.keys(base.embedders||{}).length){
  settings.embedders=semanticEmbedderSettings(process.env);
  for(const embedder of Object.values(settings.embedders))if(embedder)embedder.documentTemplate="{% for field in fields %}{% if field.name == 'cfpSemanticText' %}{{field.value}}{% endif %}{% endfor %}";
 }
 return settings;
}
async function enrich(shop,docs,config){
 const needsExtras=config.productDateType!=='published'||config.fields.some(f=>(f.search||f.suggest)&&f.weight>0&&(f.key==='description'||f.key==='barcode'||f.key.startsWith('variantMetafield:')||f.key.startsWith('productMetafield:')&&f.key!=='productMetafield:*'));
 if(!needsExtras)return docs;
 const {unauthenticated}=await import('../shopify.server.js');const {admin}=await unauthenticated.admin(shop);
 return readSearchIndexExtras(admin,docs,config);
}
// Separator-only title changes have an exact saved-DB candidate set. Other
// transformations compare saved documents, but never rebuild or replace them.
export function searchRuleCandidates(before,after){
 const old=validateSearchSettings(before),next=validateSearchSettings(after);
 const strip=s=>({...searchIndexConfiguration(s),fields:s.fields.map(f=>f.key==='title'?{...f,delimiter:'',delimiters:[]}:f)});
 if(JSON.stringify(strip(old))!==JSON.stringify(strip(next)))return null;
 const a=old.fields.find(f=>f.key==='title'),b=next.fields.find(f=>f.key==='title');
 if(!a||!b||a.transforms.length||a.indexTransforms.length||a.numeric)return null;
 const separators=[...new Set([a.delimiter,b.delimiter,...(a.delimiters||[]),...(b.delimiters||[])].filter(Boolean))];
 return separators.length?{OR:separators.map(contains=>({title:{contains}}))}:null;
}
const projectionSignature=config=>JSON.stringify({fields:config.fields.map(f=>({...f,weight:f.weight>0?1:0})),tentativeDelimiters:config.tentativeDelimiters,hideUnavailableVariants:config.hideUnavailableVariants,productDateType:config.productDateType});
const fieldInputs=field=>JSON.stringify([field.key,field.numeric,field.delimiter,field.delimiters||[],field.transforms,field.indexTransforms]);
const changesField=(field,old,before,config)=>!old||fieldInputs(field)!==fieldInputs(old)||JSON.stringify(before.tentativeDelimiters)!==JSON.stringify(config.tentativeDelimiters)||before.hideUnavailableVariants!==config.hideUnavailableVariants&&/^(sku|barcode|option:|variantMetafield:)/.test(field.key);
export function searchRulePatch(source,current,config,before,forceFields=[]){
 const projected=projectConfiguredSearchDocument(source,config),patch={id:source.id};
 if(before){
  for(const [index,field] of config.fields.entries()){
   const oldIndex=before.fields.findIndex(previous=>previous.key===field.key),old=before.fields[oldIndex];
   if(!forceFields.includes(field.key)&&!changesField(field,old,before,config)&&Object.hasOwn(current,searchFieldName(oldIndex)))projected[searchFieldName(index)]=current[searchFieldName(oldIndex)];
  }
  for(const key of Object.keys(projected))if(key.startsWith('cfp_field_')&&!config.fields.some((_field,index)=>key===searchFieldName(index)))delete projected[key];
  projected.cfpSemanticText=config.fields.flatMap((field,index)=>field.search&&field.weight>0?[field.label+': '+(projected[searchFieldName(index)]||[]).join(', ')]:[]).join('. ').slice(0,12000);
  if(config.productDateType===before.productDateType)projected.createdAt=current.createdAt;
  if(config.hideUnavailableVariants===before.hideUnavailableVariants&&Object.hasOwn(current,'cfpSkuNormalized'))projected.cfpSkuNormalized=current.cfpSkuNormalized;
 }
 const keys=new Set([...Object.keys(projected),...Object.keys(current)].filter(key=>key.startsWith('cfp_field_')||['cfpSemanticText','cfpSkuNormalized','createdAt'].includes(key)));
 for(const key of keys){const value=projected[key]??null;if(JSON.stringify(value)!==JSON.stringify(current[key]??null))patch[key]=value;}
 return Object.keys(patch).length>1?patch:null;
}
async function processSearchRuleUpdate(shop,requested,row){
 const config=validateSearchSettings(row.config),state=stateOf(row),update=state.update;
 if(!update||update.hash!==requested||state.requested!==requested||identity(shop,config)!==requested||!state.active?.uid)return {superseded:true};
 const uid=state.active.uid,index=client.index(uid),before=validateSearchSettings(update.from);
 try{
  if(!update.applied){
   // Settings changes reuse the existing documents. Collection requests continue
   // using the shared index; this changes only this shop's private search index.
   const desired=await indexSettings(config),existing=await index.getSettings();
   const ruleSettings=new Set(['searchableAttributes','stopWords','separatorTokens','nonSeparatorTokens','typoTolerance']);
   const changes=Object.fromEntries(Object.entries(desired).filter(([key,value])=>ruleSettings.has(key)&&JSON.stringify(value)!==JSON.stringify(existing[key])));
   if(Object.keys(changes).length)await wait(await index.updateSettings(changes));
   const applied=await changeState(shop,(current,latest)=>current.update?.hash!==requested||identity(shop,latest)!==requested?null:{...current,update:{...current.update,applied:true},phase:'building'});
   if(!applied)return {superseded:true};
  }
  const needsDocuments=update.forceScan||projectionSignature(before)!==projectionSignature(config);
  let docs=[],complete=true,total=0,cursor=update.cursor,offset=update.offset;
  const sourceRevision=await redis.get(sourceRevisionKey(shop))||'0';
  if(update.sourceRevision!==undefined&&update.sourceRevision!==sourceRevision){offset=0;cursor=null;}
  const sourceTask=await redis.get(sourceTaskKey(shop));if(sourceTask!=null)await wait({taskUid:Number(sourceTask)});
  const candidates=needsDocuments&&!update.forceScan?searchRuleCandidates(before,config):null;
  const changedFields=config.fields.filter(field=>(update.forceFields||[]).includes(field.key)||changesField(field,before.fields.find(old=>old.key===field.key),before,config));
  const sourceFields=new Set(['id','shop','status']);
  for(const field of changedFields){
   if(field.key.startsWith('productMetafield:'))sourceFields.add('*');
   else if(field.key.startsWith('option:')){sourceFields.add('options');if(config.hideUnavailableVariants)sourceFields.add('variantPrices');}
   else if(/^(sku|barcode|variantMetafield:)/.test(field.key))sourceFields.add('variantPrices');
   else sourceFields.add(field.key==='collections'?'collection_titles':field.key);
  }
  if(before.hideUnavailableVariants!==config.hideUnavailableVariants)sourceFields.add('variantPrices');
  const sourceProjection=sourceFields.has('*')?{}:{fields:[...sourceFields]};
  if(needsDocuments){
   if(candidates){
    const where={shop,status:{in:['ACTIVE','active']},...candidates};
    const [ids,count]=await Promise.all([prisma.product.findMany({where:{...where,...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:'asc'},take:100,select:{id:true}}),prisma.product.count({where})]);
    total=count;complete=ids.length<100;cursor=ids.at(-1)?.id||cursor;
    if(ids.length){const result=await client.index('products').getDocuments({filter:`shop = ${JSON.stringify(shop)} AND id IN ${JSON.stringify(ids.map(p=>p.id.split('/').pop()))}`,limit:ids.length,...sourceProjection});docs=result.results;if(!Array.isArray(docs)||docs.length!==ids.length)throw Error('Saved product search data is incomplete');}
    offset+=ids.length;
   }else{
    const result=await client.index('products').getDocuments({filter:`shop = ${JSON.stringify(shop)}`,offset,limit:100,...sourceProjection});
    if(!Array.isArray(result.results)||!Number.isSafeInteger(result.total))throw Error('Incomplete saved search data');
    docs=result.results;total=result.total;offset+=docs.length;complete=offset>=total;
    if(!complete&&!docs.length)throw Error('Saved search comparison did not advance');
   }
  }
  if(docs.some(doc=>doc.shop!==shop))throw Error('Saved search tenant mismatch');
  let changed=0;
  if(docs.length){
   const current=await index.getDocuments({filter:`shop = ${JSON.stringify(shop)} AND id IN ${JSON.stringify(docs.map(doc=>String(doc.id)))}`,limit:docs.length,fields:['id','shop','createdAt','cfpSemanticText','cfpSkuNormalized',...before.fields.map((_field,index)=>searchFieldName(index))]});
   if(!Array.isArray(current.results))throw Error('Incomplete existing search data');
   const byId=new Map(current.results.map(doc=>[String(doc.id),doc]));
   const patches=docs.filter(doc=>doc.status==='ACTIVE').map(doc=>{
    const saved=byId.get(String(doc.id));if(!saved||saved.shop!==shop)throw Error('Existing search product is missing');
    // Extras already held in the serving document are reusable; never fetch
    // the entire Shopify catalog to apply a text transformation.
    const source={...saved,...doc};
    if(config.productDateType!==before.productDateType)throw Error('Changing product date requires saved source dates');
    for(const field of config.fields.filter(f=>(f.search||f.suggest)&&f.weight>0&&changesField(f,before.fields.find(old=>old.key===f.key),before,config))){
     if(field.key==='description'&&!Object.hasOwn(source,'description'))throw Error('Description is not available in saved search data');
     if(field.key.startsWith('variantMetafield:')&&!before.fields.some(f=>f.key===field.key))throw Error('Variant metafield is not available in saved search data');
     if(field.key.startsWith('productMetafield:')&&field.key!=='productMetafield:*'&&!Object.hasOwn(source,'metafield_'+field.key.slice(17)))throw Error('Metafield is not available in saved search data');
    }
    return searchRulePatch(source,saved,config,before,update.forceFields);
   }).filter(Boolean);
   if(patches.length){
    // A newer save can supersede this batch while reads are in flight.
    const latest=await prisma.searchSetting.findUnique({where:{shop}});
    if(stateOf(latest).update?.hash!==requested)return {superseded:true};
    await wait(await index.updateDocuments(await withHeldEmbeddingsForIndex(index,patches)));changed=patches.length;
   }
  }
  if((await redis.get(sourceRevisionKey(shop))||'0')!==sourceRevision){complete=false;offset=0;cursor=null;}
  const next=await changeState(shop,(current,latest)=>current.update?.hash!==requested||identity(shop,latest)!==requested?null:{...current,phase:complete?'ready':'building',processed:offset,total,error:null,updatedAt:Date.now(),update:complete?null:{...current.update,sourceRevision,offset,cursor,processed:offset,updated:(current.update.updated||0)+changed},...(complete?{active:{uid,hash:requested,config},lastUpdate:{processed:offset,updated:(current.update.updated||0)+changed}}:{})});
  if(!next)return {superseded:true};
  if(!complete)await enqueue('SEARCH_INDEX_BUILD',{shop,hash:requested,incremental:true},'search-patch-'+hash([shop,requested,offset,cursor,randomUUID()]));
  return {complete,processed:offset,updated:changed,total,incremental:true};
 }catch(error){await changeState(shop,current=>current.update?.hash!==requested?null:{...current,phase:'failed',error:error.name,updatedAt:Date.now()});throw error;}
}
export async function processSearchIndexJob(data){
 const {shop}=data;if(!validShop(shop))throw Error('Invalid shop');
 const row=await prisma.searchSetting.findUnique({where:{shop}});
 if(data.retireUid){
  if(!data.retireUid.startsWith('cfp_search_'+hash(shop).slice(0,16)+'_'))throw Error('Search index tenant mismatch');
  const state=stateOf(row);if([state.active?.uid,state.build?.uid].includes(data.retireUid))return {retained:true};
  try{await wait(await client.deleteIndex(data.retireUid));}catch(error){if(meiliErrorCode(error)!=='index_not_found')throw error;}
  return {retired:true};
 }
 if(!row)return {skipped:true};
 const config=validateSearchSettings(row.config),state=stateOf(row);
 if(data.ids){if(data.sourceTaskUid!=null)await wait({taskUid:data.sourceTaskUid});return updateSearchIndexProducts(shop,data.ids,row);}
 if(data.incremental)return processSearchRuleUpdate(shop,data.hash,row);
 if(state.active?.uid&&state.build&&state.requested===data.hash){
  // Adopt jobs queued by the previous release without copying the catalog again.
  await scheduleSearchIndex(shop,{allowInitialBuild:false});return {convertedToIncremental:true};
 }
 if(!state.build||state.requested!==data.hash||identity(shop,config)!==data.hash)return {superseded:true};
 const build=state.build,index=client.index(build.uid);
 try{
  if(!build.initialized){
   try{await client.getIndex(build.uid);}catch(error){if(meiliErrorCode(error)!=='index_not_found')throw error;await wait(await client.createIndex(build.uid,{primaryKey:'id'}));}
   await wait(await index.updateSettings(await indexSettings(config)));
   const synonyms=await prisma.synonym.findMany({where:{shop,isActive:true}}),dictionary={};
   for(const row of synonyms){const terms=[row.word,...row.synonyms.split(',')].map(t=>t.trim().toLowerCase()).filter(Boolean);for(const term of terms)dictionary[term]=[...new Set([...(dictionary[term]||[]),...terms.filter(t=>t!==term)])];}
   await wait(await index.updateSynonyms(dictionary));
   build.initialized=true;
  }
  // Source deletions can shift unvisited documents behind a saved offset.
  const sourceRevision=await redis.get(sourceRevisionKey(shop))||'0';
  const sourceTask=await redis.get(sourceTaskKey(shop));if(sourceTask!=null)await wait({taskUid:Number(sourceTask)});
  if(build.sourceRevision!==sourceRevision){await wait(await index.deleteAllDocuments());build.offset=0;build.sourceRevision=sourceRevision;}
  const response=await client.index('products').getDocuments({filter:`shop = ${JSON.stringify(shop)}`,offset:build.offset,limit:requiresCustomSearchIndex(config)?20:100});
  if(!Array.isArray(response.results)||!Number.isSafeInteger(response.total))throw Error('Incomplete source catalog response');
  const docs=response.results.filter(p=>p.shop===shop&&p.status==='ACTIVE');
  if(docs.length){const enriched=await enrich(shop,docs,config);await wait(await index.addDocuments(await withHeldEmbeddingsForIndex(index,enriched.map(doc=>projectConfiguredSearchDocument(doc,config)))));}
  let offset=build.offset+response.results.length;
  const changed=(await redis.get(sourceRevisionKey(shop))||'0')!==sourceRevision;
  const complete=!changed&&offset>=response.total;
  if(changed){build.sourceRevision=null;offset=0;}
  if(!complete&&!response.results.length)throw Error('Search index scan did not advance');
  const next=await changeState(shop,(current,latest)=>current.build?.uid!==build.uid||current.requested!==data.hash||identity(shop,latest)!==data.hash?null:{...current,phase:complete?'ready':'building',build:complete?null:{...build,offset},processed:offset,total:response.total,error:null,updatedAt:Date.now(),...(complete?{active:{uid:build.uid,hash:data.hash,config}}:{})});
  if(!next)return {superseded:true};
  if(complete&&state.active?.uid!==build.uid)await retireSearchIndexes(shop,[state.active?.uid]);
  if(!complete)await enqueue('SEARCH_INDEX_BUILD',data,'search-build-'+hash([shop,data.hash,offset,randomUUID()]));
  return {complete,processed:offset,total:response.total};
 }catch(error){
  await changeState(shop,current=>current.requested!==data.hash?null:{...current,phase:'failed',build,error:error.name,updatedAt:Date.now()});throw error;
 }
}
export async function scheduleSearchIndexProducts(shop,ids,sourceTaskUid){
 if(!validShop(shop))return;
 const row=await prisma.searchSetting.findUnique({where:{shop},select:{config:true}});const state=stateOf(row);if(!state.active&&!state.build)return;
 if(sourceTaskUid!=null)await redis.eval("local old=redis.call('GET',KEYS[1]); if not old or tonumber(ARGV[1])>tonumber(old) then redis.call('SET',KEYS[1],ARGV[1]); end; return 1",1,sourceTaskKey(shop),String(sourceTaskUid));
 await redis.incr(sourceRevisionKey(shop));
 const unique=[...new Set(ids.map(id=>String(id).split('/').pop()))].filter(id=>/^\d+$/.test(id));
 for(let i=0;i<unique.length;i+=20){const batch=unique.slice(i,i+20);await enqueue('SEARCH_INDEX_PRODUCTS',{shop,ids:batch,sourceTaskUid},'search-products-'+hash([shop,batch,sourceTaskUid??Date.now()]),7);}
}
async function updateSearchIndexProducts(shop,ids,row){
 const state=stateOf(row),targets=[state.active&&{...state.active,config:state.update?.applied?validateSearchSettings(row.config):state.active.config},state.build&&{uid:state.build.uid,config:validateSearchSettings(row.config)}].filter(t=>t?.uid&&t.config);
 if(!targets.length)return {skipped:true};
 const base=await client.index('products').getDocuments({filter:`shop = ${JSON.stringify(shop)} AND id IN ${JSON.stringify(ids)}`,limit:ids.length});
 if(!Array.isArray(base.results))throw Error('Incomplete source catalog delta');
 const docs=base.results.filter(p=>p.shop===shop&&p.status==='ACTIVE'),found=new Set(docs.map(p=>String(p.id)));
 for(const target of targets){
  const index=client.index(target.uid),config=validateSearchSettings(target.config),enriched=await enrich(shop,docs,config);
  if(enriched.length)await wait(await index.addDocuments(await withHeldEmbeddingsForIndex(index,enriched.map(p=>projectConfiguredSearchDocument(p,config)))));
  const removed=ids.filter(id=>!found.has(id));if(removed.length)await wait(await index.deleteDocuments(removed));
 }
 await redis.incr(revisionKey(shop));return {updated:docs.length};
}
