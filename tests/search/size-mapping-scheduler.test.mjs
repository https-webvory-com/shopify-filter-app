import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleUnclassifiedSizeMappings, sizeMappingBackfillJobId } from '../../app/utils/sizeMappingScheduler.js';

test('backfill queues unclassified active variants once per installed shop', async () => {
  const rows = [{ shop: 'one.myshopify.com' }, { shop: 'two.myshopify.com' }, { shop: 'bad shop' }];
  const jobs = new Map(), added = [];
  const database = {
    session: { findMany: async () => rows },
    variant: { findFirst: async ({ where }) => {
      assert.deepEqual(where.OR, [
        { sizeUsNumeric: null, sizeMappingFlag: null },
        { sizeMappingFlag: 'REQUIRES_REINDEX' },
      ]);
      return where.product.shop === 'one.myshopify.com' ? { id: 'variant-1' } : null;
    } },
  };
  const queue = {
    getJob: async id => jobs.get(id) || null,
    add: async (name, data, options) => {
      added.push({ name, data, options });
      jobs.set(options.jobId, { getState: async () => 'waiting' });
    },
  };
  assert.deepEqual(await scheduleUnclassifiedSizeMappings(database, queue), { checked: 3, queued: 1, pending: 0 });
  assert.equal(added[0].name, 'SIZE_MAPPING_REBUILD');
  assert.equal(added[0].options.jobId, sizeMappingBackfillJobId('one.myshopify.com'));
  assert.deepEqual(await scheduleUnclassifiedSizeMappings(database, queue), { checked: 3, queued: 0, pending: 1 });
  assert.equal(added.length, 1);
});

test('a failed backfill can be scheduled again when unclassified variants remain', async () => {
  let removed = 0, added = 0;
  const database = {
    session: { findMany: async () => [{ shop: 'one.myshopify.com' }] },
    variant: { findFirst: async () => ({ id: 'still-unclassified' }) },
  };
  const queue = {
    getJob: async () => ({ getState: async () => 'failed', remove: async () => { removed++; } }),
    add: async () => { added++; },
  };
  assert.deepEqual(await scheduleUnclassifiedSizeMappings(database, queue), { checked: 1, queued: 1, pending: 0 });
  assert.equal(removed, 1);
  assert.equal(added, 1);
});
