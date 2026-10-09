import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { buildCollectionSequence, readRankedCollectionPage, collectionRankingFields, hydrateCollectionInventory } from '../../app/utils/rankedCollectionPage.js';

const context = { module: { exports: {} }, exports: {}, console, require: () => ({ __esModule: true, default: {} }) };
vm.runInNewContext((await transform(await fs.readFile('app/services/merchandising.server.js', 'utf8'), { format: 'cjs' })).code, context);
const { applyMerchandisingRules: apply, buildMeiliRuleFilter } = context.module.exports;
const indexFor = docs => ({
  search: async (_q, options) => ({ hits: docs.slice(options.offset, options.offset + options.limit), estimatedTotalHits: docs.length }),
  getDocument: async id => docs.find(p => p.id === id),
});
const build = (docs, conditions, extra = {}) => buildCollectionSequence(indexFor(docs), {
  query: { q: '', filter: [] }, pinnedIds: [], orderedIds: docs.map(p => p.id),
  arrange: products => apply(products, { conditions }, 'best-selling', null, [], { preserveCollectionBestSellingOrder: true }), ...extra,
});

test('tag-only ranking avoids transferring variant arrays; option rules retain variant and image data', () => {
  assert.deepEqual(collectionRankingFields([{field:'Tags'}], 'best-selling'), ['id', 'tags']);
  assert.deepEqual(collectionRankingFields([], 'best-selling'), ['id']);
  assert.ok(collectionRankingFields([], 'best-selling', false).includes('bestSellingScore'));
  assert.ok(collectionRankingFields([{field:'Color (product option)'}], 'best-selling').includes('variantPrices'));
  assert.ok(collectionRankingFields([{field:'Color (product option)'}], 'best-selling').includes('images'));
  assert.ok(collectionRankingFields([], 'price-descending').includes('priceMin'));
});

test('global Champagne rule pins survive later Dynamic Set and follow native order after explicit pins', async () => {
  const docs = [{id:'pin',tags:['BestFormal']},{id:'satin',tags:['BestFormal']},{id:'corset',tags:['BestFormal']},{id:'drape',tags:['BestFormal','Champagne']},{id:'adora',tags:['BestFormal','Champagne Gold']}];
  const conditions=[{action:'Pin',field:'Tags',value:'Champagne, Champagne Gold'},{action:'Dynamic',field:'Tags',value:'BestFormal',operator:'Set',operand:'1000'}];
  const ids=await build(docs,conditions,{pinnedIds:['pin'],arrange:products=>apply(products,{conditions},'best-selling',{products:[{id:'gid://shopify/Product/pin'}]},[],{preserveCollectionBestSellingOrder:true})});
  assert.deepEqual(Array.from(ids),['pin','drape','adora','satin','corset']);
});

test('legacy inventory is hydrated in batches and zero bounds exclude sold-out products',async()=>{
  const docs=[{id:'1',inventoryTotal:5},{id:'2'},{id:'3'}];let requested;
  const conditions=[{action:'Exclude',field:'Available',value:'-999',maxValue:'0'}];
  const ids=await build(docs,conditions,{conditions,sortBy:'best-selling',hydrateRanking:products=>hydrateCollectionInventory(products,{groupBy:async query=>{requested=query.where.productId.in;return [{productId:'gid://shopify/Product/2',_sum:{inventory:4}},{productId:'gid://shopify/Product/3',_sum:{inventory:0}}];}})});
  assert.deepEqual(Array.from(requested),['gid://shopify/Product/2','gid://shopify/Product/3']);
  assert.deepEqual(Array.from(ids),['1','2']);
  assert.deepEqual(collectionRankingFields(conditions,'best-selling'),['id','inventoryTotal']);
});

test('all merchandising score levels are globally ordered before page boundaries', async () => {
  const docs = [{ id: '1', tags: ['low'] }, { id: '2', tags: ['high'] }, { id: '3', tags: ['high'] }, { id: '4', tags: ['low'] }];
  const conditions = [{ action: 'Dynamic', field: 'Tags', value: 'high', operator: 'Set', operand: '1000' }, { action: 'Dynamic', field: 'Tags', value: 'low', operator: 'Set', operand: '950' }];
  const ids = await build(docs, conditions);
  assert.deepEqual(Array.from(ids), ['2', '3', '1', '4']);
  const first = await readRankedCollectionPage(indexFor(docs), { ids, page: 1, limit: 2 });
  const second = await readRankedCollectionPage(indexFor(docs), { ids, page: 2, limit: 2 });
  assert.deepEqual(first.hits.map(p => p.id), ['2', '3']);
  assert.deepEqual(second.hits.map(p => p.id), ['1', '4']);
});

test('exclusions run before pagination and counts, while pins remain protected', async () => {
  const docs = [{ id: '1', tags: ['blocked'] }, { id: '2', tags: ['blocked'] }, { id: '3', tags: [] }, { id: '4', tags: [] }];
  const conditions = [{ action: 'Exclude', field: 'Tags', value: 'blocked' }];
  assert.deepEqual(Array.from(buildMeiliRuleFilter(conditions)), []);
  const ids = await build(docs, conditions, {
    pinnedIds: ['1'],
    arrange: products => apply(products, { conditions }, 'best-selling', { products: [{ id: 'gid://shopify/Product/1' }] }, [], { preserveCollectionBestSellingOrder: true }),
  });
  const page = await readRankedCollectionPage(indexFor(docs), { ids, page: 1, limit: 2 });
  assert.equal(page.total, 3);
  assert.deepEqual(page.hits.map(p => p.id), ['1', '3']);
});

test('global ranking scans collections larger than one search batch', async () => {
  const docs = Array.from({ length: 2501 }, (_, i) => ({ id: String(i + 1), tags: i === 2500 ? ['high'] : [] }));
  const ids = await build(docs, [{ action: 'Dynamic', field: 'Tags', value: 'high', operator: 'Set', operand: '1000' }]);
  assert.equal(ids.length, 2501);
  assert.equal(ids[0], '2501');
  assert.equal(new Set(ids).size, 2501);
});

test('incomplete or changing search results cannot publish a ranking', async () => {
  const options = { query: { q: '', filter: [] }, pinnedIds: [], arrange: p => p };
  await assert.rejects(buildCollectionSequence({ search: async () => ({ hits: [{ id: '1' }], estimatedTotalHits: 2 }) }, options), /Incomplete/);
  await assert.rejects(buildCollectionSequence({ search: async () => ({ hits: [{ id: '1' }, { id: '1' }] }) }, options), /changed/);
});

test('pins and boosts respect sort priority settings across the whole collection', () => {
  const docs = [{ id: 'pin', priceMin: 300, tags: [] }, { id: 'boost', priceMin: 200, tags: ['boost'] }, { id: 'cheap', priceMin: 1, tags: [] }];
  const rule = { conditions: [{ action: 'Boost', field: 'Tags', value: 'boost' }] };
  const pins = { products: [{ id: 'pin' }] };
  assert.deepEqual(Array.from(apply(docs.map(p => ({ ...p })), rule, 'price-ascending', pins, [], {}), p => p.id), ['pin', 'boost', 'cheap']);
  assert.deepEqual(Array.from(apply(docs.map(p => ({ ...p })), rule, 'price-ascending', pins, [], { prioritizeSortOverPinning: true, prioritizeSortOverMerchandising: true }), p => p.id), ['cheap', 'boost', 'pin']);
});

test('a missing indexed product preserves its session slot for DB hydration', async () => {
  const result = await readRankedCollectionPage({ getDocument: async () => { throw Object.assign(Error('Missing'), { code: 'document_not_found' }); } }, { ids: ['1'], page: 1, limit: 25 });
  assert.deepEqual(result.hits, [{ id: '1' }]);
});
test('products made inactive during browsing require a fresh eligible sequence', async () => {
  await assert.rejects(readRankedCollectionPage({ getDocument: async () => ({ id: '1', status: 'ARCHIVED' }) }, { ids: ['1'], page: 1, limit: 25 }), /session expired/);
});
