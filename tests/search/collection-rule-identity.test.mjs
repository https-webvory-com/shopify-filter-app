import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import {resolveCollectionTargets} from '../../app/utils/merchandisingCondition.js';
import {collectionRankingFields} from '../../app/utils/rankedCollectionPage.js';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';
const id=n=>`gid://shopify/Collection/${n}`;
const plain=v=>JSON.parse(JSON.stringify(v));
async function service(rules=[],pins=[]) {return loadModule('app/services/merchandising.server.js',{'../db.server.js':{default:{merchandisingRule:{findMany:async()=>rules},pinnedProductRule:{findMany:async()=>pins}}}});}
test('collection IDs isolate duplicate titles, survive renames and never turn missing targets into global rules',async()=>{
 const rules=[{id:'homecoming',collections:['New Arrivals'],collectionIds:[id(1)],ordinal:1,conditions:[{action:'Dynamic',field:'Tags',value:'TopHomecoming',operator:'Set',operand:'99'}]},
 {id:'formal',collections:['New Arrivals'],collectionIds:[id(2)],ordinal:2,conditions:[{action:'Dynamic',field:'Tags',value:'TopFormal',operator:'Set',operand:'99'}]}];
 const m=await service(rules);
 assert.equal((await m.getActiveRuleForCollection('fixture','New Arrivals',[],'en',id(1))).id,'homecoming');
 assert.equal((await m.getActiveRuleForCollection('fixture','Renamed collection',[],'en','2')).id,'formal');
 assert.equal(await m.getActiveRuleForCollection('fixture','New Arrivals',[],'en',id(3)),null);
 assert.equal(await m.getActiveRuleForCollection('fixture','New Arrivals'),null,'bound rules require an actual collection identity');
});
test('pin target IDs choose the correct saved list despite identical titles',async()=>{
 const m=await service([], [{id:'wrong',collections:['Navy Dresses'],collectionSortKey:'[1]',products:[{id:'wrong'}]},
 {id:'correct',collections:['Old Navy title'],collectionSortKey:'[2]',products:[{id:'correct'}]}]);
 assert.equal((await m.getActivePinningRuleForCollection('fixture','Navy Dresses',id(2))).id,'correct');
 assert.equal(await m.getActivePinningRuleForCollection('fixture','Navy Dresses',id(3)),null);
 const legacy=await service([],[{id:'manual',collections:['Navy Dresses'],products:[]}]);
 assert.equal((await legacy.getActivePinningRuleForCollection('fixture','Navy Dresses',id(3))).id,'manual');
});
test('unverified Boost arithmetic retains legacy precedence instead of blindly treating list order as rank priority',async()=>{
 const rules=[{id:'colour',collections:['Red Dresses'],ordinal:109,conditions:[{action:'Boost',field:'Tags',value:'Red'}]},
 {id:'formal',collections:['Red Dresses','Formal Dresses'],ordinal:3,conditions:[{action:'Dynamic',field:'Tags',value:'BestFormal',operator:'Set',operand:'1000'}]}];
 const m=await service(rules);const r=await m.getActiveRuleForCollection('fixture','Red Dresses');
 assert.deepEqual(plain(r.ruleGroups.map(g=>g.id)),['colour','formal']);
 const ranked=m.applyMerchandisingRules([{id:'red',tags:['Red'],_originalIndex:0},{id:'best',tags:['BestFormal'],_originalIndex:1}],r,'best-selling',null,[],{preserveCollectionBestSellingOrder:true});
 assert.equal(ranked[0].id,'red');
 const legacy=await service(rules.map(({ordinal,...r})=>r));
 assert.deepEqual(plain((await legacy.getActiveRuleForCollection('fixture','Red Dresses')).ruleGroups.map(g=>g.id)),['colour','formal']);
});

const sequentialRules=[
 {id:'formal',ordinal:3,collections:['Blue','Formal'],collectionIds:[id(1),id(2)],conditions:[{action:'Dynamic',field:'Tags',value:'TopFormal',operator:'Set',operand:'99'},{action:'Include',field:'Tags',value:'TopFormal'},{action:'Dynamic',field:'Tags',value:'BestFormal',operator:'Set',operand:'1000'}]},
 {id:'prom',ordinal:7,collections:['Blue'],collectionIds:[id(1)],conditions:[{action:'Dynamic',field:'Tags',value:'TopProm',operator:'Set',operand:'99'},{action:'Dynamic',field:'Tags',value:'BestProm',operator:'Set',operand:'100'}]},
 {id:'champagne',ordinal:116,collections:[],conditions:[{action:'Pin',field:'Tags',value:'Champagne'}]},
];
test('observed overlapping Formal/Prom Sets replace earlier scores rather than becoming independent permanent tiers',async()=>{
 const m=await service(sequentialRules),rule=await m.getActiveRuleForCollection('fixture','Blue',[],'en',id(1));assert.equal(rule.collectionSequentialScores,true);
 const docs=[{id:'both',tags:['TopFormal','BestFormal','TopProm','BestProm','Champagne'],priceMin:20},
 {id:'formal-only',tags:['TopFormal','BestFormal','Champagne'],priceMin:30},
 {id:'top-pin',tags:['TopProm','Champagne'],priceMin:40},{id:'best',tags:['BestProm'],priceMin:10},
 {id:'unscored-pin',tags:['Champagne'],priceMin:1},{id:'top',tags:['TopProm'],priceMin:50},{id:'explicit',tags:[],priceMin:60}].map((p,i)=>({...p,_originalIndex:i}));
 const pin={products:[{id:'explicit'}]},settings={preserveCollectionBestSellingOrder:true};
 const ranked=m.applyMerchandisingRules(structuredClone(docs),rule,'best-selling',pin,[],settings);
 assert.deepEqual(plain(ranked.map(p=>p.id)),['explicit','formal-only','both','top-pin','best','top','unscored-pin']);
 assert.equal(ranked.find(p=>p.id==='formal-only').merchandisingScore,1000);
 assert.equal(ranked.find(p=>p.id==='both').merchandisingScore,100,'later BestProm Set replaces the earlier BestFormal score');
 const legacy={...rule,collectionSequentialScores:false,conditions:rule.collectionLegacyConditions};
 assert.deepEqual(plain(m.applyMerchandisingRules(structuredClone(docs),rule,'manual',pin,[],settings).map(p=>p.id)),plain(m.applyMerchandisingRules(structuredClone(docs),legacy,'manual',pin,[],settings).map(p=>p.id)));
 assert.equal(m.applyMerchandisingRules(structuredClone(docs),rule,'price-ascending',pin,[],{prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true})[0].id,'unscored-pin');
 m.applyMerchandisingRules(ranked,null,'best-selling');assert.ok(ranked.every(p=>p._collectionSequentialScore===false));
});
test('compact ranking retains sequential score mode across batches and deep page boundaries',async()=>{
 const m=await service(sequentialRules),rule=await m.getActiveRuleForCollection('fixture','Blue',[],'en',id(1));
 const docs=Array.from({length:2250},(_,i)=>({id:String(i+1),priceMin:10,available:true,tags:i%3===0?['BestFormal']:i%3===1?['BestFormal','BestProm','Champagne']:['TopProm','Champagne']}));
 const index={search:async(_q,o)=>({hits:docs.slice(o.offset,o.offset+o.limit),estimatedTotalHits:docs.length})};
 const spec={shop:'fixture',query:{q:'',filter:[]},rule,sortBy:'best-selling',needsShopifyOrder:true,orderedIds:docs.map(p=>p.id),pinnedIds:[],pinningRule:null,globalSettings:{}};
 const baseline=await prepareCollectionRanking(structuredClone(spec),{index,prisma:{},arrange:m.applyMerchandisingRules});
 const compact=await prepareCollectionRanking(structuredClone(spec),{index,prisma:{},arrange:m.applyMerchandisingRules,comparator:m.createMerchandisingComparator});
 assert.deepEqual(compact,baseline);assert.equal(compact.ids.length,2250);assert.equal(new Set(compact.ids).size,2250);
});
test('classic collection sold-out exclusions use purchasability, preserving quantity rules and search behavior',async()=>{
 const m=await service();const condition={action:'Exclude',field:'Available',minValue:'-999',maxValue:'0'};
 const rule={conditions:[condition],collectionTagMatching:'exact'};
 const products=[{id:'cancelled-stock',inventoryTotal:-26,available:true},{id:'gift-card',inventoryTotal:0,available:true},{id:'sold-out',inventoryTotal:0,available:false},{id:'old-document',inventoryTotal:3}];
 assert.deepEqual(plain(m.applyMerchandisingRules(structuredClone(products),rule,'best-selling').map(p=>p.id)),['cancelled-stock','gift-card','old-document']);
 assert.deepEqual(plain(m.applyMerchandisingRules(structuredClone(products),{conditions:[condition]},'best-selling').map(p=>p.id)),['old-document']);
 const range={...rule,conditions:[{...condition,minValue:'1',maxValue:'5'}]};
 assert.equal(m.applyMerchandisingRules([{id:'quantity',inventoryTotal:3,available:true}],range,'best-selling').length,0);
 assert.ok(collectionRankingFields([condition],'best-selling').includes('available'));
});
test('target persistence rejects cross-shop IDs and ambiguous titles and preserves unchanged retired bindings',async()=>{
 const prisma={collection:{findMany:async({where})=>{assert.equal(where.shop,'owner');return[{id:id(1),title:'New Arrivals'},{id:id(2),title:'New Arrivals'}];}}};
 assert.deepEqual(await resolveCollectionTargets(prisma,'owner',['New Arrivals'],[id(2)]),{collections:['New Arrivals'],collectionIds:[id(2)]});
 await assert.rejects(()=>resolveCollectionTargets(prisma,'owner',['New Arrivals'],[]),/specific collection/);
 await assert.rejects(()=>resolveCollectionTargets(prisma,'owner',['New Arrivals'],[id(99)]),/unavailable/);
 await assert.rejects(()=>resolveCollectionTargets(prisma,'owner',[],[id(1)]),/do not match/);
 const existing={collections:['Retired collection'],collectionIds:[id(99)]};
 assert.deepEqual(await resolveCollectionTargets(prisma,'owner',existing.collections,undefined,existing),existing);
});
