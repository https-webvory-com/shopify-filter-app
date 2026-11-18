import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './helpers/search-ranking.mjs';
import { catalogImageUrls } from '../../app/utils/pinProductImages.js';

async function fixture(initial = { id: 'existing', shop: 'fixture.myshopify.com', ruleType: 'search', searchQueries: ['blue'], status: false }) {
  const writes = [];
  let saved = { ...initial, products: [{ id: 'p1', position: 1 }, { id: 'p2', position: 2 }], applyToSearchType: 'both', applyToAll: false };
  const prisma = { filterGlobalSetting:{findUnique:async()=>({showOnlyInStock:true})}, pinnedProductRule: {
    create: async ({ data }) => { writes.push({ type: 'create', data }); saved = { id: 'created', status: true, ...data }; return saved; },
    update: async ({ where, data }) => { assert.deepEqual(JSON.parse(JSON.stringify(where)), { id: 'existing', shop: 'fixture.myshopify.com', ruleType: 'search' }); writes.push({ type: 'update', where, data }); saved = { ...saved, ...data }; return saved; },
    findFirst: async ({ where }) => saved.shop === where.shop && saved.ruleType === where.ruleType ? saved : null,
    findMany: async ({ where }) => saved.shop === where.shop && saved.ruleType === where.ruleType && saved.status === where.status ? [saved] : [],
  } };
  const route = await loadModule('app/routes/app.search.pinning.$id.jsx', {
    '../services/emptySearchPins.server.js':{legacyEmptySearchProducts:async()=>[],saveEmptySearchPin:async(shop,{products,enabled})=>{assert.equal(shop,'fixture.myshopify.com');writes.push({type:'empty',products});saved={...saved,name:'Empty search query',searchQueries:[''],applyToAll:false,applyToSearchType:enabled?'instant':'none',products};}},
    '../services/shopCache.server': { invalidateShop: async () => {} },
    '../shopify.server': { authenticate: { admin: async () => ({ session: { shop: 'fixture.myshopify.com' } }) } },
    '../db.server': { default: prisma }, '../utils/availablePins.server.js': { availablePins: async (_db, _shop, products) => products },
    '../utils/pinProductSearch.server': { pinProductSearchFilter: async () => ({}) }, '../services/searchPicker.server.js': {}, '../utils/reorderSearchPins.js': {},
    '../utils/pinProductImageFallbacks.server.js': { pinProductImageFallbacks: async () => ({}) }, '../utils/pinProductImages.js': { catalogImageUrls },
    '../components/merchandising/PinSearchField': {}, react: {}, '@shopify/app-bridge-react': {}, '@shopify/shopify-app-react-router/server': {},
    '../components/merchandising/PinProductImage': {},
    'react-router': { redirect: path => new Response(null, { status: 302, headers: { Location: path } }) },
  });
  const service = await loadModule('app/services/merchandising.server.js', { '../db.server.js': { default: prisma } });
  const submit = (queries, { id = 'existing', all = false, products = saved.products, scope = 'both' } = {}) => route.action({ params: { id }, request: new Request('https://fixture/pinning/' + id, {
    method: 'POST', body: new URLSearchParams({ intent: 'save', name: 'Custom rule name', searchQueries: queries, products: JSON.stringify(products), applyToAll: String(all), applyToSearchType: scope }),
  }) });
  return { route, service, writes, submit, saved: () => saved };
}
test('creating a pin trims one complete search phrase and preserves product order and scope', async () => {
  const f = await fixture();
  const result = await f.submit('["  Blue party dresses  "]', { id: 'new', scope: 'instant' });
  assert.equal(result.status, 302); assert.deepEqual(Array.from(f.saved().searchQueries), ['Blue party dresses']);
  assert.deepEqual(JSON.parse(JSON.stringify(f.saved().products)), [{ id: 'p1', position: 1 }, { id: 'p2', position: 2 }]);
  assert.equal(f.saved().applyToSearchType, 'instant'); assert.equal(f.saved().name, 'Custom rule name');
});
test('editing replaces the term on the same rule without enabling it or altering pinned products', async () => {
  const f = await fixture(); const before = f.saved().products;
  assert.equal((await f.submit('["green dresses"]')).status, 302);
  assert.deepEqual(Array.from(f.saved().searchQueries), ['green dresses']); assert.equal(f.saved().id, 'existing');
  assert.equal(f.saved().status, false); assert.deepEqual(JSON.parse(JSON.stringify(f.saved().products)), before); assert.equal(f.writes[0].type, 'update');
});
test('after editing, pins match the replacement term and stop matching the previous term on both search surfaces', async () => {
  const f = await fixture({ id: 'existing', shop: 'fixture.myshopify.com', ruleType: 'search', searchQueries: ['blue'], status: true });
  for (const type of ['instant', 'page']) assert.ok(await f.service.getActivePinningRuleForSearch('fixture.myshopify.com', 'blue', type));
  await f.submit('["green dresses"]');
  for (const type of ['instant', 'page']) {
    assert.equal(await f.service.getActivePinningRuleForSearch('fixture.myshopify.com', 'blue', type), null);
    assert.equal((await f.service.getActivePinningRuleForSearch('fixture.myshopify.com', ' GREEN DRESSES ', type)).id, 'existing');
  }
});
test('multiple, malformed or non-string terms are rejected before any database write', async () => {
  for (const value of ['["blue","green"]', '["blue","blue"]', 'null', '{}', '"blue"', '[null]', '[1]', '{broken']) {
    const f = await fixture(); const before = JSON.stringify(f.saved());
    const result = await f.submit(value); assert.equal(result.status, 400, value);
    assert.equal((await result.json()).error, 'Enter exactly one search term.'); assert.equal(f.writes.length, 0);
    assert.equal(JSON.stringify(f.saved()), before);
  }
});

test('blank and whitespace-only terms become empty-query pins and do not match keyword searches or search pages',async()=>{
  for(const value of ['[]','[""]','["   "]']){
    const f=await fixture({id:'existing',shop:'fixture.myshopify.com',ruleType:'search',status:true,searchQueries:['blue']});
    assert.equal((await f.submit(value,{id:'new'})).status,302);
    assert.deepEqual(Array.from(f.saved().searchQueries),['']);assert.equal(f.saved().applyToAll,false);
    assert.ok(await f.service.getActivePinningRuleForSearch('fixture.myshopify.com','','instant'));
    assert.equal(await f.service.getActivePinningRuleForSearch('fixture.myshopify.com','blue','instant'),null);
    assert.equal(await f.service.getActivePinningRuleForSearch('fixture.myshopify.com','','page'),null);
  }
});
test('legacy multi-term rules are read intact and only collapse after an explicit single-term save', async () => {
  const f = await fixture({ id: 'existing', shop: 'fixture.myshopify.com', ruleType: 'search', searchQueries: ['blue', 'green'], status: true });
  const loaded = await f.route.loader({ params: { id: 'existing' }, request: new Request('https://fixture/pinning/existing') });
  assert.deepEqual(Array.from(loaded.rule.searchQueries), ['blue', 'green']); assert.equal(f.writes.length, 0);
  assert.ok(await f.service.getActivePinningRuleForSearch('fixture.myshopify.com', 'green', 'instant'));
  assert.equal((await f.submit('["red"]')).status, 302); assert.deepEqual(Array.from(f.saved().searchQueries), ['red']);
});
test('all-search rules retain their scope while targeted phrases containing commas stay one phrase', async () => {
  const f = await fixture(); await f.submit('[]', { all: true });
  assert.equal(f.saved().applyToAll, true); assert.deepEqual(Array.from(f.saved().searchQueries), []);
  await f.submit('["blue, green"]'); assert.equal(f.saved().applyToAll, false);
  assert.deepEqual(Array.from(f.saved().searchQueries), ['blue, green']);
});
test('a targeted rule with a blank term cannot expose an unrestricted picker catalog', async () => {
  const f = await fixture();
  const result = await f.route.action({ params: { id: 'existing' }, request: new Request('https://fixture/pinning/existing', {
    method: 'POST', body: new URLSearchParams({ intent: 'search', targetQueries: '[]', applyToAll: 'false' }),
  }) });
  assert.deepEqual((await result.json()).products, []); assert.equal(f.writes.length, 0);
});
