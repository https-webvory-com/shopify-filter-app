import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { prepareCollectionRanking } from '../../app/utils/prepareCollectionRanking.js';
import { preparationKey } from '../../app/utils/collectionPreparation.js';

const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/formal-merchandising-order.json', import.meta.url)));
const prom = JSON.parse(await fs.readFile(new URL('./fixtures/prom-merchandising-order.json', import.meta.url)));
const source = (await transform(await fs.readFile('app/services/merchandising.server.js', 'utf8'), { format: 'cjs' })).code;
function service(rules = fixture.rules) {
  const context = { module: { exports: {} }, exports: {}, console,
    require: () => ({ __esModule: true, default: { merchandisingRule: { findMany: async () => rules } } }) };
  vm.runInNewContext(source, context);
  return context.module.exports;
}
const clone = value => JSON.parse(JSON.stringify(value));
const settings = { preserveCollectionBestSellingOrder: true };

for (const [name,data,title] of [['Prom',prom,'Prom Dresses'],['Formal',fixture,'Formal Dresses']]) test(`${name}: ID-bound sequential mode preserves the observed fixture and explicit pins`,async()=>{
  const ordinals={'Top Prom':7,'Top Formal':3,'sold out':32,'In-Store Styling Appointment Deposit':111,'Champagne Prom Dresses':116};
  const rules=data.rules.map(r=>({...r,ordinal:ordinals[r.name],collectionIds:r.collections?.length?['gid://shopify/Collection/1']:[]}));
  const m=service(rules),rule=await m.getActiveRuleForCollection('fixture',title,[],'en','gid://shopify/Collection/1');assert.equal(rule.collectionSequentialScores,true);
  const ranked=m.applyMerchandisingRules(clone(data.products),rule,'best-selling',{products:data.pins},[],settings);
  const expected=name==='Prom'?data.expected:data.expectedFirst25;
  assert.deepEqual(Array.from(ranked.slice(0,expected.length),p=>p.id),expected);
});

test('observed Formal Dresses first 25 follow source rule groups and actual Shopify tie order', async () => {
  const { getActiveRuleForCollection, applyMerchandisingRules } = service();
  const rule = await getActiveRuleForCollection('fixture', 'Formal Dresses');
  const pins = { products: fixture.pins };
  const ranked = applyMerchandisingRules(clone(fixture.products), rule, 'best-selling', pins, [], settings);
  assert.deepEqual(Array.from(ranked.slice(0, 25), p => p.id), fixture.expectedFirst25);
  assert.deepEqual(Array.from(ranked.slice(0, 13), p => p.id), fixture.pins.map(p => p.id));
  const flattened = { conditions: rule.conditions };
  const legacy = applyMerchandisingRules(clone(fixture.products), flattened, 'best-selling', pins, [], settings);
  assert.notEqual(legacy[13].id, fixture.expectedFirst25[13], 'fixture must reproduce the old failure');
});

test('global Pin refines each higher-priority group and does not outrank it', async () => {
  const { getActiveRuleForCollection, applyMerchandisingRules } = service();
  const rule = await getActiveRuleForCollection('fixture', 'Formal Dresses');
  const docs = [
    { id: 'ordinary-pin', tags: ['Champagne'] },
    { id: 'top', tags: ['TopFormal'] },
    { id: 'top-pin', tags: ['TopFormal', 'Champagne'] },
    { id: 'best', tags: ['TopFormal', 'BestFormal'] },
    { id: 'best-pin', tags: ['TopFormal', 'BestFormal', 'Champagne'] },
    { id: 'manual', tags: [] },
  ].map((p, i) => ({ ...p, _originalIndex: i, inventoryTotal: 5 }));
  const ranked = applyMerchandisingRules(docs, rule, 'best-selling', { products: [{ id: 'manual' }] }, [], settings);
  assert.deepEqual(Array.from(ranked, p => p.id), ['manual', 'best-pin', 'best', 'top-pin', 'top', 'ordinary-pin']);
});

test('collection tag values match exact case while the search ranking contract remains unchanged', async () => {
  const { getActiveRuleForCollection, applyMerchandisingRules } = service();
  const rule = await getActiveRuleForCollection('fixture', 'Formal Dresses');
  const docs = [{ id: 'upper', tags: ['CHAMPAGNE'], _originalIndex: 0, inventoryTotal: 5 },
    { id: 'exact', tags: ['Champagne'], _originalIndex: 1, inventoryTotal: 5 }];
  assert.deepEqual(Array.from(applyMerchandisingRules(clone(docs), rule, 'best-selling', null, [], settings), p => p.id), ['exact', 'upper']);
  const searchRule = { conditions: [{ action: 'Pin', field: 'Tags', value: 'Champagne' }] };
  assert.deepEqual(Array.from(applyMerchandisingRules(clone(docs), searchRule, 'best-selling', null, [], settings), p => p.id), ['upper', 'exact']);
});

test('a single collection rule retains its numeric ranking and exact tag matching', async () => {
  const { getActiveRuleForCollection, applyMerchandisingRules } = service([fixture.rules[0]]);
  const rule = await getActiveRuleForCollection('fixture', 'Formal Dresses');
  const docs = [{ id: 'case', tags: ['BESTFORMAL'], _originalIndex: 0 },
    { id: 'top', tags: ['TopFormal'], _originalIndex: 1 }, { id: 'best', tags: ['BestFormal'], _originalIndex: 2 }];
  assert.deepEqual(Array.from(applyMerchandisingRules(docs, rule, 'best-selling', null, [], settings), p => p.id), ['best', 'top', 'case']);
});

test('compact worker ranking retains rule groups across batches and page boundaries', async () => {
  const { getActiveRuleForCollection, applyMerchandisingRules: arrange, createMerchandisingComparator: comparator } = service();
  const rule = await getActiveRuleForCollection('fixture', 'Formal Dresses');
  const docs = Array.from({ length: 20250 }, (_, i) => ({ id: String(i + 1), priceMin: 10, inventoryTotal: i % 23 ? 5 : 0,
    tags: [i % 3 ? 'TopFormal' : 'ordinary', i % 5 ? 'other' : 'BestFormal', i % 7 ? 'other' : 'Champagne'] }));
  const index = { search: async (_q, options) => ({ hits: docs.slice(options.offset, options.offset + options.limit), estimatedTotalHits: docs.length }) };
  const spec = { shop: 'fixture', query: { q: '', filter: [] }, rule, sortBy: 'best-selling', needsShopifyOrder: true,
    orderedIds: docs.map(p => p.id), pinnedIds: ['1'], pinningRule: { products: [{ id: 'gid://shopify/Product/1' }] }, globalSettings: {} };
  const baseline = await prepareCollectionRanking(clone(spec), { index, prisma: {}, arrange });
  const compact = await prepareCollectionRanking(clone(spec), { index, prisma: {}, arrange, comparator });
  assert.deepEqual(compact, baseline);
  assert.equal(compact.ids[0], '1', 'explicit pin remains protected from exclusion');
  assert.equal(new Set(compact.ids).size, compact.ids.length);
  const oldRule = { ...rule }; delete oldRule.ruleGroups; delete oldRule.collectionTagMatching;
  assert.notEqual(preparationKey(spec), preparationKey({ ...spec, rule: oldRule }), 'old prepared sequences cannot mask the fix');
});

test('customer sort overrides and stale product ranking state remain safe', async () => {
  const { getActiveRuleForCollection, applyMerchandisingRules } = service();
  const rule = await getActiveRuleForCollection('fixture', 'Formal Dresses');
  const docs = [{ id: 'cheap', priceMin: 1, tags: [], inventoryTotal: 5 },
    { id: 'best', priceMin: 100, tags: ['TopFormal', 'BestFormal'], inventoryTotal: 5 }];
  const ranked = applyMerchandisingRules(docs, rule, 'best-selling', null, [], settings);
  assert.equal(ranked[0].id, 'best');
  const sorted = applyMerchandisingRules(ranked, rule, 'price-ascending', null, [], { prioritizeSortOverMerchandising: true });
  assert.equal(sorted[0].id, 'cheap');
  applyMerchandisingRules(sorted, null, 'best-selling');
  assert.ok(sorted.every(p => p._collectionRuleRanks === undefined));
});

test('observed Prom shared 100 follow merchandising Pin before its ordinary 99/100 score ladder', async () => {
  const { getActiveRuleForCollection, applyMerchandisingRules } = service(prom.rules);
  const rule = await getActiveRuleForCollection('fixture', 'Prom Dresses');
  assert.equal(rule.collectionPinsFirst, true);
  const ranked = applyMerchandisingRules(clone(prom.products), rule, 'best-selling', {products:prom.pins}, [], settings);
  assert.deepEqual(Array.from(ranked,p=>p.id),prom.expected);
  assert.equal(ranked[15].id,'gid://shopify/Product/15046990037363');
  assert.deepEqual(Array.from(ranked.slice(0,9),p=>p.id),prom.pins.map(p=>p.id));
  const previous={...rule};delete previous.collectionPinsFirst;
  assert.notEqual(applyMerchandisingRules(clone(prom.products),previous,'best-selling',{products:prom.pins},[],settings)[15].id,prom.expected[15]);
  assert.notEqual(preparationKey({rule}),preparationKey({rule:previous}),'old cached rankings cannot mask the new precedence');
});

test('ordinary ladder recognition is independent of names and refuses stronger or unsupported arithmetic rules', () => {
  const {usesCollectionPinFirstLadder}=service();
  const rules=[{conditions:[{action:'Dynamic',field:'Tags',value:'first',operator:'Set',operand:'99'},
    {action:'Include',field:'Tags',value:'first'}, {action:'Dynamic',field:'Tags',value:'second',operator:'Set',operand:'100'}]},
    {conditions:[{action:'Pin',field:'Tags',value:'colour'}]}];
  assert.equal(usesCollectionPinFirstLadder(rules),true);
  for(const change of [{operand:'1000'},{operator:'Multiply'},{field:'Price'},{operand:'100oops'}]){
    const altered=clone(rules);Object.assign(altered[0].conditions[2],change);
    assert.equal(usesCollectionPinFirstLadder(altered),false);
  }
  assert.equal(usesCollectionPinFirstLadder(rules.slice(0,1)),false);
  const unsupported=clone(rules);unsupported[1].conditions.push({action:'Boost',field:'Tags',value:'third'});
  assert.equal(usesCollectionPinFirstLadder(unsupported),false);
});

test('Prom ladder membership prevents unscored Champagne pins jumping the scored group', async () => {
  const {getActiveRuleForCollection,applyMerchandisingRules}=service(prom.rules);
  const rule=await getActiveRuleForCollection('fixture','Prom Dresses');
  const docs=[{id:'unscored-pin',tags:['Champagne']},{id:'best',tags:['TopProm','BestProm']},
    {id:'top-pin',tags:['TopProm','Champagne']},{id:'top',tags:['TopProm']},
    {id:'ordinary',tags:[]},{id:'explicit',tags:[]}].map((p,i)=>({...p,priceMin:10,inventoryTotal:5,_originalIndex:i}));
  const ranked=applyMerchandisingRules(clone(docs),rule,'best-selling',{products:[{id:'explicit'}]},[],settings);
  assert.deepEqual(Array.from(ranked,p=>p.id),['explicit','top-pin','best','top','unscored-pin','ordinary']);
  const old={...rule};delete old.collectionLadderBoundaryVersion;
  assert.notEqual(preparationKey({rule}),preparationKey({rule:old}));
  applyMerchandisingRules(ranked,null,'best-selling');
  assert.ok(ranked.every(p=>p._collectionLadderMatched===false));
});

test('Prom customer sort overrides, exclusions, manual ranking and stale state retain their behavior', async () => {
  const {getActiveRuleForCollection,applyMerchandisingRules}=service(prom.rules);
  const rule=await getActiveRuleForCollection('fixture','Prom Dresses');
  const docs=[{id:'cheap',priceMin:1,tags:['TopProm','BestProm'],inventoryTotal:5},
    {id:'champagne',priceMin:50,tags:['TopProm','Champagne'],inventoryTotal:5},
    {id:'sold',priceMin:0,tags:['TopProm','Champagne'],inventoryTotal:0}];
  const sorted=applyMerchandisingRules(clone(docs),rule,'price-ascending',null,[],{prioritizeSortOverMerchandising:true});
  assert.deepEqual(Array.from(sorted,p=>p.id),['cheap','champagne']);
  const previous={...rule};delete previous.collectionPinsFirst;
  for(const sort of ['manual','price-ascending']) {
    const opts=sort==='manual'?{}:{prioritizeSortOverMerchandising:true};
    assert.deepEqual(Array.from(applyMerchandisingRules(clone(docs),rule,sort,null,[],opts),p=>p.id),
      Array.from(applyMerchandisingRules(clone(docs),previous,sort,null,[],opts),p=>p.id));
  }
  applyMerchandisingRules(sorted,null,'best-selling');
  assert.ok(sorted.every(p=>p._collectionPinsFirst===false));
});

test('compact Prom ranking carries pin precedence across batches and deep pages', async () => {
  const {getActiveRuleForCollection,applyMerchandisingRules:arrange,createMerchandisingComparator:comparator}=service(prom.rules);
  const rule=await getActiveRuleForCollection('fixture','Prom Dresses');
  const docs=Array.from({length:20250},(_,i)=>({id:String(i+1),priceMin:10,inventoryTotal:5,tags:i%3===0?['Champagne']:i%3===1?['TopProm','BestProm']:['TopProm','Champagne']}));
  const index={search:async(_q,options)=>({hits:docs.slice(options.offset,options.offset+options.limit),estimatedTotalHits:docs.length})};
  const spec={shop:'fixture',query:{q:'',filter:[]},rule,sortBy:'best-selling',needsShopifyOrder:true,orderedIds:docs.map(p=>p.id),pinnedIds:[],globalSettings:{}};
  const baseline=await prepareCollectionRanking(clone(spec),{index,prisma:{},arrange});
  const compact=await prepareCollectionRanking(clone(spec),{index,prisma:{},arrange,comparator});
  assert.deepEqual(compact,baseline);
  assert.deepEqual(compact.ids, [2,1,0].flatMap(remainder=>docs.filter((_,i)=>i%3===remainder).map(p=>p.id)));
  assert.equal(new Set(compact.ids).size,20250);
});
