import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { transform } from 'esbuild';

const values = new Map();
const redis = { get: async key => values.get(key), setex: async (key, ttl, value) => { assert.equal(ttl, 3600); values.set(key, value); } };
const context = { module: { exports: {} }, exports: {}, URL, require: name => name === 'node:crypto' ? crypto : { __esModule: true, default: redis } };
vm.runInNewContext((await transform(await fs.readFile('app/services/collectionRankingSession.server.js', 'utf8'), { format: 'cjs' })).code, context);
const { collectionRankingFingerprint: fingerprint, getCollectionRankingSession: get, saveCollectionRankingSession: save } = context.module.exports;

test('page number and token do not change the session fingerprint, filters do', () => {
  assert.equal(fingerprint('https://app.test/api/filter?shop=s&page=1&limit=25'), fingerprint('https://app.test/api/filter?limit=25&shop=s&page=2&rankingToken=x'));
  assert.notEqual(fingerprint('https://app.test/api/filter?shop=s'), fingerprint('https://app.test/api/filter?shop=s&options[Color][]=Black'));
});

test('compact response negotiation does not invalidate an existing browsing token',()=>{
 assert.equal(fingerprint('https://app.test/api/filter?shop=s&page=1'),fingerprint('https://app.test/api/filter?shop=s&page=2&responseProfile=collection-v1'));
});
test('subsequent pages retain their saved sequence after Shopify changes order', async () => {
  const first = await save('shop', 'filters', ['1', '2', '3', '4'], 1);
  await save('shop', 'filters', ['4', '3', '2', '1'], 2);
  const retained = await get('shop', 'filters', first.token);
  assert.deepEqual(Array.from(retained.ids), ['1', '2', '3', '4']);
  assert.equal(retained.updatedAt, 1);
});
test('identical rankings share a record while changed rankings get a new token', async () => {
  const a = await save('shop', 'same-filters', ['1', '2'], 1);
  const b = await save('shop', 'same-filters', ['1', '2'], 1);
  const changed = await save('shop', 'same-filters', ['2', '1'], 1);
  assert.equal(a.token, b.token);
  assert.notEqual(a.token, changed.token);
});
test('expired, cross-shop and changed-filter tokens require a restart', async () => {
  const session = await save('shop', 'filters', ['1'], 1);
  await assert.rejects(get('other-shop', 'filters', session.token), /expired/);
  await assert.rejects(get('shop', 'other-filter', session.token), /expired/);
  values.delete(`collectionRankingSession:shop:${session.token}`);
  await assert.rejects(get('shop', 'filters', session.token), /expired/);
  await assert.rejects(get('shop', 'filters', 'invalid'), /Invalid/);
});
