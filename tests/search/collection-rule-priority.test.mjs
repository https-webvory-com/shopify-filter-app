import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { prepareCollectionRanking } from '../../app/utils/prepareCollectionRanking.js';
import { preparationKey } from '../../app/utils/collectionPreparation.js';

const fixture = JSON.parse(await fs.readFile(new URL('./fixtures/formal-merchandising-order.json', import.meta.url)));
const source = (await transform(await fs.readFile('app/services/merchandising.server.js', 'utf8'), { format: 'cjs' })).code;
function service(rules = fixture.rules) {
  const context = { module: { exports: {} }, exports: {}, console,
    require: () => ({ __esModule: true, default: { merchandisingRule: { findMany: async () => rules } } }) };
  vm.runInNewContext(source, context);
  return context.module.exports;
}
const clone = value => JSON.parse(JSON.stringify(value));
const settings = { preserveCollectionBestSellingOrder: true };

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
  const docs = Array.from({ length: 2250 }, (_, i) => ({ id: String(i + 1), priceMin: 10, inventoryTotal: i % 23 ? 5 : 0,
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
