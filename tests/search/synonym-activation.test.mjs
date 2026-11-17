import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {transform} from 'esbuild';
import * as crypto from 'node:crypto';

async function load(file, mocks) {
  const context = {module: {exports: {}}, exports: {}, console: {error() {}}, Response,
    require: name => {if (!(name in mocks)) throw Error(`Unexpected import: ${name}`); return mocks[name];}};
  vm.runInNewContext((await transform(await fs.readFile(file, 'utf8'), {format: 'cjs'})).code, context);
  return context.module.exports;
}
const shop = 'fixture.myshopify.com';
const plain = value => JSON.parse(JSON.stringify(value));
async function fixture() {
  const cache = new Map(), jobs = new Map(), writes = [], engine = [];
  let rules = [{word: 'gown', synonyms: 'dress, formal', isActive: true}], active = 'private-index', failQueue = false, failEngine = false, hold;
  const dictionaryModule = await load('app/services/synonyms.server.js', {
    '../db.server': {}, '../utils/searchSettings.js': {}, './searchIndex.server.js': {},
  });
  const redis = {get: async key => cache.get(key) || null, set: async (key, value) => cache.set(key, value), del: async key => cache.delete(key)};
  const queue = {
    setGlobalConcurrency: async value => writes.push(['concurrency', value]),
    add: async (name, data, options) => {
      if (failQueue) throw Error('Queue offline');
      const job = {id: options.jobId, name, data: plain(data), options: plain(options), state: 'delayed', getState: async () => job.state};
      jobs.set(job.id, job); return job;
    }, getJob: async id => jobs.get(id),
  };
  const prisma = {synonym: {findMany: async ({where}) => {assert.equal(where.shop, shop); return plain(rules);}},
    searchSetting: {findUnique: async ({where}) => {assert.equal(where.shop, shop); return {config: {_index: {active: active ? {uid: active} : null}}};}}};
  const service = await load('app/services/synonymActivation.server.js', {
    'node:crypto': crypto, '../db.server.js': {__esModule: true, default: prisma},
    './redis.server.js': {__esModule: true, default: redis}, './queue.server.js': {synonymQueue: queue},
    './synonyms.server.js': dictionaryModule,
    './searchIndex.server.js': {syncConfiguredSearchSynonyms: async (tenant, dictionary) => {
      engine.push([tenant, plain(dictionary)]); if (hold) await hold; if (failEngine) throw Error('Engine unavailable');
    }},
  });
  return {service, jobs, cache, writes, engine, setRules: value => rules = value, setActive: value => active = value,
    failQueue: () => failQueue = true, failEngine: value => failEngine = value,
    holdEngine: value => hold = value};
}

test('save queues durable delayed work without calling the engine, and reports applying then active', async () => {
  const f = await fixture();
  const id = await f.service.queueSynonymActivation(shop);
  assert.equal(f.engine.length, 0);
  const job = f.jobs.get(id);
  assert.equal(job.options.attempts, 5); assert.equal(job.options.backoff.type, 'exponential');
  assert.equal(job.options.delay, 1500); assert.deepEqual(f.writes, [['concurrency', 1]]);
  assert.equal((await f.service.getSynonymActivationStatus(shop)).phase, 'applying');
  await f.service.processSynonymActivation(job.data); job.state = 'completed';
  assert.equal((await f.service.getSynonymActivationStatus(shop)).phase, 'active');
  assert.deepEqual(f.engine, [[shop, {gown: ['dress', 'formal'], dress: ['gown'], formal: ['gown']}]]);
});

test('rapid edits apply only the latest rules and redundant queued jobs skip engine work', async () => {
  const f = await fixture(); await f.service.queueSynonymActivation(shop);
  f.setRules([{word: 'new', synonyms: 'latest', isActive: true}]); await f.service.queueSynonymActivation(shop);
  for (const job of f.jobs.values()) await f.service.processSynonymActivation(job.data);
  assert.equal(f.engine.length, 1); assert.deepEqual(f.engine[0][1], {new: ['latest'], latest: ['new']});
});

test('edits during an in-flight application cannot be marked active until the latest version succeeds', async () => {
  const f = await fixture(); await f.service.queueSynonymActivation(shop);
  let release; f.holdEngine(new Promise(resolve => release = resolve));
  const running = f.service.processSynonymActivation({shop});
  while (!f.engine.length) await new Promise(resolve => setImmediate(resolve));
  f.setRules([{word: 'new', synonyms: 'latest', isActive: true}]); await f.service.queueSynonymActivation(shop);
  release(); await assert.rejects(running, /changed during activation/);
  assert.equal((await f.service.getSynonymActivationStatus(shop)).phase, 'applying');
  f.holdEngine(null); await f.service.processSynonymActivation({shop});
  assert.equal((await f.service.getSynonymActivationStatus(shop)).phase, 'active');
});

test('engine failures remain pending during automatic retries, expose terminal failure and can be retried', async () => {
  const f = await fixture(); const id = await f.service.queueSynonymActivation(shop); f.failEngine(true);
  await assert.rejects(f.service.processSynonymActivation({shop}), /Engine unavailable/);
  assert.equal((await f.service.getSynonymActivationStatus(shop)).phase, 'applying');
  f.jobs.get(id).state = 'failed'; assert.equal((await f.service.getSynonymActivationStatus(shop)).phase, 'failed');
  await f.service.queueSynonymActivation(shop); f.failEngine(false); await f.service.processSynonymActivation({shop});
  assert.equal((await f.service.getSynonymActivationStatus(shop)).phase, 'active');
});

test('reverting to a previous version during an intervening update cannot report it active prematurely', async () => {
  const f = await fixture(); await f.service.processSynonymActivation({shop});
  f.setRules([{word: 'new', synonyms: 'latest', isActive: true}]); await f.service.queueSynonymActivation(shop);
  let release; f.holdEngine(new Promise(resolve => release = resolve));
  const running = f.service.processSynonymActivation({shop});
  while (f.engine.length < 2) await new Promise(resolve => setImmediate(resolve));
  f.setRules([{word: 'gown', synonyms: 'dress, formal', isActive: true}]); await f.service.queueSynonymActivation(shop);
  assert.equal((await f.service.getSynonymActivationStatus(shop)).phase, 'applying');
  release(); await assert.rejects(running, /changed during activation/); f.holdEngine(null);
  await f.service.processSynonymActivation({shop}); assert.equal((await f.service.getSynonymActivationStatus(shop)).phase, 'active');
});

test('disabling or deleting the last rule clears engine synonyms; revisions include the active index', async () => {
  const f = await fixture(); await f.service.processSynonymActivation({shop});
  f.setRules([{word: 'gown', synonyms: 'dress', isActive: false}]);
  await f.service.processSynonymActivation({shop}); assert.deepEqual(f.engine.at(-1)[1], {});
  f.setActive('new-private-index'); await f.service.processSynonymActivation({shop});
  assert.equal(f.engine.length, 3);
});

test('missing search setup fails honestly without starting a catalog build, and invalid tenants are rejected', async () => {
  const f = await fixture(); f.setActive(null);
  await assert.rejects(f.service.processSynonymActivation({shop}), /not ready/);
  assert.equal(f.engine.length, 0);
  await assert.rejects(f.service.queueSynonymActivation('not-a-shop'), /Invalid shop/);
  await assert.rejects(f.service.getSynonymActivationStatus('not-a-shop'), /Invalid shop/);
});

test('canonical dictionaries ignore ordering and duplicates while preserving bidirectional meaning', async () => {
  const f = await fixture(); await f.service.processSynonymActivation({shop});
  f.setRules([{word: 'gown', synonyms: 'formal, dress, dress', isActive: true}]);
  await f.service.processSynonymActivation({shop}); assert.equal(f.engine.length, 1);
});

async function routeAction(dependencies) {
  const source = await fs.readFile('app/routes/app.search.synonyms.jsx', 'utf8');
  const ast = ts.createSourceFile('route.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const node = ast.statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'action'));
  return vm.runInNewContext(`(${node.declarationList.declarations[0].initializer.getText(ast)})`, {
    authenticate: {admin: async () => ({session: {shop}})}, console: {error() {}}, ...dependencies,
  });
}
const request = values => new Request('http://fixture/app/search/synonyms', {method: 'POST', body: new URLSearchParams(values)});

test('add/update/delete/toggle return after database and queue only, with honest saved feedback', async () => {
  for (const intent of ['add', 'update', 'delete', 'toggleStatus']) {
    const events = [];
    const action = await routeAction({prisma: {synonym: {
      findFirst: async () => null, create: async () => events.push('write'), update: async ({where}) => {assert.equal(where.shop, shop); events.push('write');},
      delete: async ({where}) => {assert.equal(where.shop, shop); events.push('write');},
    }}, queueSynonymActivation: async tenant => {assert.equal(tenant, shop); events.push('queued');}});
    const result = await action({request: request({intent, word: 'gown', synonyms: 'dress', id: 'rule-1', isActive: 'true'})});
    assert.equal(result.success, true); assert.match(result.message, /Applying to search/);
    assert.deepEqual(events, ['write', 'queued']);
  }
});

test('queue failure preserves the saved rule and exposes retry, while retry does not write the rule again', async () => {
  let writes = 0;
  const action = await routeAction({prisma: {synonym: {findFirst: async () => null, create: async () => writes++}},
    queueSynonymActivation: async () => {throw Error('Queue offline');}});
  const result = await action({request: request({intent: 'add', word: 'gown', synonyms: 'dress'})});
  assert.equal(result.saved, true); assert.equal(result.success, undefined); assert.match(result.error, /Retry activation/);
  assert.equal(writes, 1);
  assert.equal((await action({request: request({intent: 'retryActivation'})})).saved, true);
  const retry = await routeAction({queueSynonymActivation: async tenant => assert.equal(tenant, shop)});
  assert.equal((await retry({request: request({intent: 'retryActivation'})})).success, true);
});

test('invalid input and failed writes never enqueue an activation', async () => {
  let queued = 0;
  const action = await routeAction({prisma: {synonym: {findFirst: async () => null, create: async () => {throw Error('Database offline');}}},
    queueSynonymActivation: async () => queued++});
  assert.equal((await action({request: request({intent: 'add', word: '', synonyms: 'dress'})})).status, 400);
  assert.equal((await action({request: request({intent: 'add', word: 'gown', synonyms: 'dress'})})).status, 500);
  assert.equal((await action({request: request({intent: 'unknown'})})).status, 400);
  assert.equal(queued, 0);
});

test('status polling is scoped to the authenticated store and cannot trigger engine or catalog work', async () => {
  let tenant;
  const route = await load('app/routes/app.synonym-status.jsx', {
    '../shopify.server': {authenticate: {admin: async () => ({session: {shop}})}},
    '../services/synonymActivation.server.js': {getSynonymActivationStatus: async value => {tenant = value; return {phase: 'active'};}},
  });
  const response = await route.loader({request: new Request('http://fixture/app/synonym-status?shop=other.myshopify.com')});
  assert.equal(tenant, shop); assert.equal((await response.json()).phase, 'active');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
