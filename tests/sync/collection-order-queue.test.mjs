import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';

test('collection order queue is independent, retrying and reused on reload', async () => {
  const queues = [];
  class Queue {
    constructor(name, options) { this.name = name; this.options = options; queues.push(this); }
    on() {}
  }
  const context = { module: { exports: {} }, exports: {}, global: {}, console,
    require: name => { assert.equal(name, 'bullmq'); return { Queue }; } };
  const source = (await transform(await fs.readFile('app/services/queue.server.js', 'utf8'), { format: 'cjs' })).code;
  vm.runInNewContext(`(function(){${source}\n})();`, context);
  const order = context.module.exports.collectionOrderQueue;
  assert.equal(order.name, 'collectionOrderQueueV1');
  assert.notEqual(order, context.module.exports.webhookQueue);
  assert.notEqual(order, context.module.exports.collectionRankingQueue);
  assert.equal(order.options.defaultJobOptions.attempts, 5);
  assert.equal(order.options.defaultJobOptions.backoff.type, 'exponential');
  vm.runInNewContext(`(function(){${source}\n})();`, context);
  assert.equal(context.module.exports.collectionOrderQueue, order);
  assert.equal(queues.length, 4);
});

test('order worker runs without consuming webhook slots and retries failures', async () => {
  const workers = [], calls = [];
  let error;
  class Worker {
    constructor(name, processor, options) { Object.assign(this, { name, processor, options, opts: options }); workers.push(this); }
    on() {}
  }
  const source = (await fs.readFile('app/workers/webhookWorker.server.js', 'utf8'))
    .replace(/^import .*;\r?\n/gm, '')
    .replaceAll('await import(', 'await loadModule(')
    .replace('export function initWebhookWorker', 'function initWebhookWorker');
  const context = vm.createContext({ Worker, global: {}, redisOptions: {}, process: { env: {} }, console,
    loadModule: async path => {
      assert.equal(path, '../services/collectionBestSelling.server.js');
      return { refreshCollectionBestSelling: async (shop, collectionId) => {
        calls.push({ shop, collectionId }); if (error) throw error;
      } };
    },
  });
  vm.runInContext(source, context);
  vm.runInContext('initWebhookWorker(); initWebhookWorker();', context);
  assert.equal(workers.length, 4);
  const order = workers.find(worker => worker.name === 'collectionOrderQueueV1');
  assert.equal(order.options.concurrency, 1);
  assert.equal(order.options.connection.maxRetriesPerRequest, null);
  const job = { name: 'COLLECTION_BEST_SELLING_REFRESH', data: { shop: 'fixture.myshopify.com', collectionId: 'gid://shopify/Collection/1' } };
  await order.processor(job);
  assert.deepEqual(calls, [job.data]);
  error = Error('Shopify unavailable');
  await assert.rejects(order.processor(job), /Shopify unavailable/);
  await assert.rejects(order.processor({ name: 'PRODUCTS_UPDATE' }), /Unknown collection order job/);
});
