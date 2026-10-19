import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionCandidateIndex} from '../../app/utils/collectionCandidateIndex.js';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';
import {createCollectionFactProfile,projectCollectionRuleFacts} from '../../app/utils/collectionRuleFacts.js';
import {loadModule} from './helpers/search-ranking.mjs';

function fixture(count=12025){
 const native=Array.from({length:count},(_,i)=>({id:String(i+1),priceMin:i===15?0:20+i%100,tags:[i%2?'Top':'ordinary',...(i%3===0?['Pin']:[])],available:true,inventoryTotal:10}));
 const outside=[{id:'x1',priceMin:40,tags:['Top'],available:true,inventoryTotal:10},{id:'x2',priceMin:50,tags:['Top'],available:true,inventoryTotal:10}];
 const docs=[...outside.slice().reverse(),...native.slice().reverse()],base=[outside[0],...native,outside[1]],calls=[];
 let settings={distinctAttribute:null,pagination:{maxTotalHits:100000}},browseOverride;
 const index={getSettings:async()=>settings,getDocuments:async options=>{
  calls.push({type:'browse',...options});
  const ids=typeof options.filter==='string'&&options.filter.startsWith('id IN ')?JSON.parse(options.filter.slice(6)):null;
  const rows=ids?docs.filter(p=>ids.includes(p.id)):docs;
  return browseOverride?browseOverride(options):{results:rows.slice(options.offset,options.offset+options.limit),total:rows.length};
 },search:async(q,options)=>{
  calls.push({type:'search',q,...options});const restricted=(Array.isArray(options.filter)?options.filter:[]).find(f=>typeof f==='string'&&f.startsWith('id IN '));
  const ids=restricted?JSON.parse(restricted.slice(6)):null,rows=base.filter(p=>!ids||ids.includes(p.id));
  return {hits:rows.slice(options.offset||0,(options.offset||0)+options.limit),estimatedTotalHits:rows.length};
 }};
 const spec={shop:'fixture',retainForIdle:true,needsShopifyOrder:true,sortBy:'best-selling',query:{q:'',filter:['tenant filter',['Include OR member','available']],sort:['bestSellingScore:desc']},orderedIds:native.map(p=>p.id),pinnedIds:[],globalSettings:{},mergedValues:[]};
 return {index,spec,calls,docs,setSettings:x=>settings=x,setBrowse:x=>browseOverride=x};
}

test('filtered browse preserves complete canonical rule/pin/zero-price order and outside Include ties',async()=>{
 const m=await loadModule('app/services/merchandising.server.js',{'../db.server.js':{default:{}}}),f=fixture();
 const conditions=[{field:'Tags',value:'Top',action:'Dynamic',operator:'Set',operand:'100'},{field:'Tags',value:'Pin',action:'Pin'}];
 const spec={...f.spec,rule:{conditions,collectionTagMatching:'exact',collectionIds:['1']},pinningRule:{products:[{id:'gid://shopify/Product/5'},{id:'gid://shopify/Product/99999'}]},pinnedIds:['5','99999']};
 const deps={prisma:{product:{findMany:async()=>[{id:'gid://shopify/Product/99999',priceMin:99}]}},arrange:m.applyMerchandisingRules,comparator:m.createMerchandisingComparator,captureReuse:true};
 const baseline=await prepareCollectionRanking(spec,{...deps,index:f.index});f.calls.length=0;
 const actual=await prepareCollectionRanking(spec,{...deps,index:createCollectionCandidateIndex(f.index,spec)});
 assert.deepEqual(actual,baseline);assert.equal(actual.ids.at(-1),'16');assert.deepEqual(actual.ids.slice(0,2),['5','99999']);
 const queries=f.calls.filter(c=>c.type==='search');assert.equal(queries.length,1);assert.deepEqual(queries[0].attributesToRetrieve,['id']);assert.deepEqual(queries[0].sort,spec.query.sort);
 assert.ok(f.calls.filter(c=>c.type==='browse').every(c=>c.limit===1000&&JSON.stringify(c.filter)===JSON.stringify(spec.query.filter)));
});

test('native-only collection avoids a search sort; explicit missing pins keep canonical placeholders',async()=>{
 const f=fixture(20);f.spec.orderedIds.push('x1','x2');
 const index=createCollectionCandidateIndex(f.index,f.spec);
 const result=await index.search('',{...f.spec.query,attributesToRetrieve:['id'],limit:10000,offset:0});
 assert.equal(result.hits.length,22);assert.equal(f.calls.filter(c=>c.type==='search').length,0);
 const settingsCases=[{...f.spec,retainForIdle:false},{...f.spec,needsShopifyOrder:false},{...f.spec,sortBy:'price-ascending'},{...f.spec,query:{...f.spec.query,q:'red'}},{...f.spec,query:{...f.spec.query,distinct:'vendor'}}];
 for(const spec of settingsCases)assert.equal(createCollectionCandidateIndex(f.index,spec),f.index);
});

test('distinct settings, unavailable browse, oversized proofs and unstable scans fall back to canonical search',async()=>{
 for(const scenario of ['distinct','displayed','error','bytes','count','duplicates','truncated','outside']){
  const f=fixture(scenario==='outside'?0:30);const options={...f.spec.query,attributesToRetrieve:['id'],limit:10000,offset:0};
  if(scenario==='distinct')f.setSettings({distinctAttribute:'vendor'});
  if(scenario==='displayed')f.setSettings({displayedAttributes:['id']});
  if(scenario==='error')f.setBrowse(()=>{throw Error('unsupported documents filter');});
  if(scenario==='duplicates')f.setBrowse(()=>({results:[f.docs[0],f.docs[0]],total:2}));
  if(scenario==='truncated')f.setBrowse(()=>({results:f.docs.slice(0,2),total:32}));
  if(scenario==='outside')f.spec.orderedIds=[];
  const optimized=createCollectionCandidateIndex(f.index,f.spec,{...(scenario==='bytes'?{maxBytes:1}:{}),...(scenario==='count'?{maxDocuments:1}:{})});
  const result=await optimized.search('',options);
  assert.deepEqual(new Set(result.hits.map(p=>p.id)),new Set(f.docs.map(p=>p.id)),scenario);
  if(scenario!=='outside')assert.ok(f.calls.some(c=>c.type==='search'&&!c.filter.some(f=>typeof f==='string'&&f.startsWith('id IN '))),scenario);
 }
});

test('maintained indexed variant facts preserve canonical images and complete order through the browse path',async()=>{
 const m=await loadModule('app/services/merchandising.server.js',{'../db.server.js':{default:{}}}),f=fixture(140);
 const conditions=[{action:'Boost',field:'Color (product option)',value:'Wine'}],profile=createCollectionFactProfile(conditions);
 for(const p of f.docs){p.options=[{name:'Color',values:['Wine']}];p.variantPrices=[{option1:'Wine',available:true,imageUrl:'wine-'+p.id+'.jpg',price:p.priceMin}];Object.assign(p,projectCollectionRuleFacts(p,profile,m.checkRuleMatch));}
 const spec={...f.spec,rule:{conditions}},deps={prisma:{},arrange:m.applyMerchandisingRules,comparator:m.createMerchandisingComparator};
 const baseline=await prepareCollectionRanking(spec,{...deps,index:f.index});
 const actual=await prepareCollectionRanking(spec,{...deps,index:createCollectionCandidateIndex(f.index,spec),factProfile:profile});
 assert.deepEqual(actual,baseline);
});

test('large outside sets and counts changing across browse pages never publish incomplete rankings',async()=>{
 for(const scenario of ['outside','counts']){
  const f=fixture(1200);if(scenario==='outside')f.spec.orderedIds=[];
  else f.setBrowse(options=>({results:f.docs.slice(options.offset,options.offset+options.limit),total:f.docs.length-(options.offset?1:0)}));
  const result=await createCollectionCandidateIndex(f.index,f.spec).search('',{...f.spec.query,attributesToRetrieve:['id'],offset:0,limit:10000});
  assert.equal(result.hits.length,f.docs.length);
  assert.ok(f.calls.some(c=>c.type==='search'&&!c.filter.some(f=>typeof f==='string'&&f.startsWith('id IN '))));
 }
});

test('failed outside-order proofs fall back, and cancelled visitors stop without launching fallback searches',async()=>{
 const f=fixture(30),search=f.index.search;
 f.index.search=async(q,options)=>options.filter.some(f=>typeof f==='string'&&f.startsWith('id IN '))?{hits:[{id:'unrelated'}]}:search(q,options);
 const options={...f.spec.query,attributesToRetrieve:['id'],offset:0,limit:10000};
 assert.equal((await createCollectionCandidateIndex(f.index,f.spec).search('',options)).hits.length,32);
 const controller=new AbortController();controller.abort();f.calls.length=0;
 await assert.rejects(createCollectionCandidateIndex(f.index,f.spec,{signal:controller.signal}).search('',options));
 assert.equal(f.calls.length,0);
});
