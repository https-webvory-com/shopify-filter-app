import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { normalizedSizeSource } from '../../app/utils/sizeMappingRebuild.js';

test('admin size mappings validate input and scope edits to the authenticated shop', async () => {
  const calls = [];
  const source = await fs.readFile('app/routes/app.filters.size-mapping.jsx', 'utf8');
  const prisma = { sizeNumericMapping: {
    upsert: async args => { calls.push(['upsert', args]); return {}; },
    deleteMany: async args => { calls.push(['delete', args]); return { count: 1 }; },
  } };
  const mocks = {
    'react-router': { useFetcher() {}, useLoaderData() {} },
    'react/jsx-runtime': { jsx() {}, jsxs() {} },
    '../shopify.server.js': { authenticate: { admin: async () => ({ session: { shop: 'safe.myshopify.com' } }) } },
    '../db.server.js': { __esModule: true, default: prisma },
    '../services/sizeMapping.server.js': { normalizedSizeSource, enqueueSizeMappingRebuild: async shop => calls.push(['queue', shop]) },
  };
  const context = { module: { exports: {} }, exports: {}, require: name => {
    if (!mocks[name]) throw Error(`Unexpected import ${name}`);
    return mocks[name];
  } };
  vm.runInNewContext((await transform(source, { format: 'cjs', loader: 'jsx' })).code, context);
  const action = context.module.exports.action;
  const request = values => ({ formData: async () => new Map(Object.entries(values)) });
  const saved = await action({ request: request({ intent: 'save', sourceValue: ' XL ', sizeUsNumeric: '18', shop: 'attacker.myshopify.com' }) });
  assert.equal(saved.ok, true, saved.message);
  assert.equal(calls[0][1].where.shop_sourceValue.shop, 'safe.myshopify.com');
  assert.equal(calls[0][1].create.sourceValue, 'xl');
  assert.deepEqual(calls[1], ['queue', 'safe.myshopify.com']);
  assert.equal((await action({ request: request({ intent: 'save', sourceValue: 'XL', sizeUsNumeric: '99' }) })).ok, false);
  assert.equal(calls.length, 2);
  assert.equal((await action({ request: request({ intent: 'delete', id: 'mapping-other-shop' }) })).ok, true);
  assert.equal(calls[2][1].where.shop, 'safe.myshopify.com');
});
