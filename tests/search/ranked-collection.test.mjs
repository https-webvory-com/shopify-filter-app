import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { buildCollectionSequence, readRankedCollectionPage, collectionRankingFields, hydrateCollectionInventory, hydrateCollectionPrices } from '../../app/utils/rankedCollectionPage.js';

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

test('large collections fetch at most four batches concurrently and preserve exact order', async () => {
  const docs = Array.from({length: 5501}, (_, index) => ({id: String(index), priceMin: 1}));
  let active = 0, peak = 0;
  const offsets = [];
  const index = {search: async (_q, options) => {
    active++; peak = Math.max(peak, active); offsets.push(options.offset);
    assert.deepEqual(options.attributesToRetrieve, ['id', 'priceMin']);
    await new Promise(resolve => setTimeout(resolve, options.offset === 1000 ? 15 : 1));
    active--;
    return {hits: docs.slice(options.offset, options.offset + options.limit), estimatedTotalHits: docs.length};
  }};
  const ids = await buildCollectionSequence(index, {
    query: {q: '', filter: ['shop = "fixture"']}, conditions: [], sortBy: 'best-selling',
    orderedIds: docs.map(doc => doc.id), pinnedIds: [], arrange: products => products,
  });
  assert.equal(peak, 4); assert.deepEqual(offsets, [0, 1000, 2000, 3000, 4000, 5000]);
  assert.deepEqual(ids, docs.map(doc => doc.id));
});

test('parallel ranking rejects changing totals and partial batches', async () => {
  for (const changedTotal of [true, false]) {
    const index = {search: async (_q, options) => ({
      hits: Array.from({length: options.offset ? (changedTotal ? 500 : 499) : 1000}, (_, n) => ({id: String(options.offset + n)})),
      estimatedTotalHits: options.offset && changedTotal ? 1501 : 1500,
    })};
    await assert.rejects(buildCollectionSequence(index, {
      query: {q: ''}, conditions: [], sortBy: 'best-selling', pinnedIds: [], arrange: products => products,
    }), /Incomplete/);
  }
});

test('page products use one shop-scoped query and retain token order and missing pin slots', async () => {
  const calls=[];
  const index={search:async(q, options)=>{
    calls.push(options);assert.equal(q,'');
    return {hits:[{id:'1',status:'ACTIVE'},{id:'3',status:'ACTIVE'}]};
  }};
  const result=await readRankedCollectionPage(index,{ids:['3','missing-pin','1'],page:1,limit:25,shop:'fixture',attributes:['id','status']});
  assert.equal(calls.length,1);assert.deepEqual(calls[0].filter,['shop = "fixture"','id IN ["3","missing-pin","1"]']);
  assert.deepEqual(result.hits.map(product=>product.id),['3','missing-pin','1']);assert.equal(result.total,3);
  assert.deepEqual(calls[0].attributesToRetrieve,['id','status']);
});

test('bulk page retrieval rejects inactive products and propagates service errors', async () => {
  const options={ids:['1'],page:1,limit:25,shop:'fixture'};
  await assert.rejects(readRankedCollectionPage({search:async()=>({hits:[{id:'1',status:'ARCHIVED'}]})},options),/session expired/);
  await assert.rejects(readRankedCollectionPage({search:async()=>{throw Error('Search unavailable');}},options),/Search unavailable/);
});

test('Hydrogen best selling keeps Shopify order with zero-price products last', async () => {
  const docs = [{id:'liquid',priceMin:0},{id:'oxygen',priceMin:1025},{id:'hydrogen',priceMin:0}];
  assert.deepEqual(await build(docs, [], {sortBy:'best-selling'}), ['oxygen','liquid','hydrogen']);
});

test('Accessories partitions the full collection before pagination and preserves both groups', async () => {
  const docs = [{id:'liquid',priceMin:0},{id:'oxygen',priceMin:1025},{id:'hydrogen',priceMin:0},
    {id:'shirt',priceMin:2111},{id:'product2',priceMin:10},{id:'product1',priceMin:10},
    {id:'compare',priceMin:785.95},{id:'complete',priceMin:699.95}];
  const ids = await build(docs, [], {sortBy:'best-selling'});
  assert.deepEqual(ids, ['oxygen','shirt','product2','product1','compare','complete','liquid','hydrogen']);
  const pages = [];
  for (let page=1; page<=3; page++) {
    const result = await readRankedCollectionPage(indexFor(docs), {ids,page,limit:3});
    assert.equal(result.total, 8);
    pages.push(...result.hits.map(p=>p.id));
  }
  assert.deepEqual(pages, ids);
});

test('missing and invalid prices are not classified as zero', async () => {
  const docs = [{id:'free',priceMin:'0'},{id:'missing'},{id:'null',priceMin:null},
    {id:'empty',priceMin:''},{id:'invalid',priceMin:'unknown'},{id:'paid',priceMin:1}];
  assert.deepEqual(await build(docs, [], {sortBy:'bestselling'}), ['missing','null','empty','invalid','paid','free']);
});

test('other collection sorts do not move zero-price products to the end', async () => {
  const docs = [{id:'free',priceMin:0},{id:'paid',priceMin:5}];
  for (const sortBy of ['price-ascending','price-descending','title-ascending','created-descending','manual']) {
    assert.deepEqual(await build(docs, [], {sortBy,arrange:products=>products}), ['free','paid']);
  }
});

test('pins awaiting indexing hydrate prices from the same shop before zero-price partitioning', async () => {
  let query;
  const docs = [{id:'paid',priceMin:10}];
  const ids = await build(docs, [], {sortBy:'best-selling',pinnedIds:['free-pin'],
    hydrateRanking:products=>hydrateCollectionPrices(products,{findMany:async options=>{
      query=options;
      return [{id:'gid://shopify/Product/free-pin',priceMin:0}];
    }},'test-shop'),
    arrange:products=>apply(products,null,'best-selling',{products:[{id:'gid://shopify/Product/free-pin'}]},[],{preserveCollectionBestSellingOrder:true})});
  assert.deepEqual(query.where, {shop:'test-shop',id:{in:['gid://shopify/Product/free-pin']}});
  assert.deepEqual(ids, ['paid','free-pin']);
});

test('paid pins and boosts retain priority while zero-price products stay in the final group', async () => {
  const docs = [{id:'free',priceMin:0,tags:['boost']},{id:'ordinary',priceMin:5},
    {id:'boost',priceMin:10,tags:['boost']},{id:'pin',priceMin:20}];
  const conditions = [{action:'Boost',field:'Tags',value:'boost'}];
  const ids = await build(docs, conditions, {sortBy:'best-selling',pinnedIds:['pin'],
    arrange:products=>apply(products,{conditions},'best-selling',{products:[{id:'gid://shopify/Product/pin'}]},[],{preserveCollectionBestSellingOrder:true})});
  assert.deepEqual(ids, ['pin','boost','ordinary','free']);
});

test('tag-only ranking avoids transferring variant arrays; option rules retain variant and image data', () => {
  assert.deepEqual(collectionRankingFields([{field:'Tags'}], 'best-selling'), ['id', 'priceMin', 'tags']);
  assert.deepEqual(collectionRankingFields([], 'best-selling'), ['id', 'priceMin']);
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
  assert.deepEqual(collectionRankingFields(conditions,'best-selling'),['id','priceMin','inventoryTotal']);
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
