import test from 'node:test';
import assert from 'node:assert/strict';
import { readOrderPage, validateOrderScanCount } from '../../app/utils/orderPage.js';

test('order pagination retries a throttled page without changing its cursor', async () => {
  const cursors = [], delays = [];
  const admin = { graphql: async (_query, options) => {
    cursors.push(options.variables.cursor);
    if (cursors.length === 1) return { ok: false, status: 429 };
    return { ok: true, json: async () => ({ data: { orders: {
      nodes: [{ id: 'order-1' }], pageInfo: { hasNextPage: false, endCursor: 'next' },
    } } }) };
  } };
  const page = await readOrderPage(admin, 'query', 'saved', ms => { delays.push(ms); });
  assert.deepEqual(cursors, ['saved', 'saved']);
  assert.deepEqual(delays, [2000]);
  assert.equal(page.nodes[0].id, 'order-1');
});

test('historical order scans cannot replace a known complete catalog with a partial scan', () => {
  assert.throws(() => validateOrderScanCount(112900, 241575), /incomplete/);
  assert.doesNotThrow(() => validateOrderScanCount(242374, 241575));
  assert.doesNotThrow(() => validateOrderScanCount(0, null));
});

test('order pagination reacquires an expiring Admin client and retries a 401 on the same cursor', async () => {
  const cursors = [], delays = [];
  let clientCount = 0;
  const freshClient = async () => {
    const number = ++clientCount;
    return { graphql: async (_query, options) => {
      cursors.push(options.variables.cursor);
      if (number === 1) throw Error('Received an error response (401 Unauthorized) from Shopify');
      return { ok: true, json: async () => ({ data: { orders: {
        nodes: [{ id: 'order-2' }], pageInfo: { hasNextPage: false, endCursor: 'end' },
      } } }) };
    } };
  };
  const page = await readOrderPage(freshClient, 'query', 'saved', ms => { delays.push(ms); });
  assert.equal(clientCount, 2);
  assert.deepEqual(cursors, ['saved', 'saved']);
  assert.deepEqual(delays, [2000]);
  assert.equal(page.nodes[0].id, 'order-2');
});

test('order pagination rejects incomplete or non-retryable responses', async () => {
  await assert.rejects(readOrderPage({ graphql: async () => ({ ok: true,
    json: async () => ({ data: { orders: { nodes: [] } } }) }) }, 'query', null),
  /Incomplete Shopify orders page/);
  await assert.rejects(readOrderPage({ graphql: async () => ({ ok: true,
    json: async () => ({ errors: [{ extensions: { code: 'ACCESS_DENIED' } }] }) }) }, 'query', null),
  /ACCESS_DENIED/);
});
