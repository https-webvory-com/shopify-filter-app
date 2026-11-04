import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { normalizeSearchEvent, normalizeSearchEventBatch } from '../../app/utils/searchAnalytics.js';

const now = new Date('2026-10-30T12:00:00Z');
const shop = 'example.myshopify.com';
const event = { event_id: 'evt_12345678', event: 'search_query', shop,
  ts: now.toISOString(), anon_id: 'anon_12345678', search_id: 'search_12345678',
  market: 'US', q: 'blue dress', email: 'private@example.com', ip: '127.0.0.1' };

test('analytics validation keeps only allowed anonymous fields and rejects forged events', () => {
  const saved = normalizeSearchEvent(event, { shop, now });
  assert.equal(saved.query, 'blue dress');
  assert.equal(Object.hasOwn(saved, 'email'), false);
  assert.equal(Object.hasOwn(saved, 'ip'), false);
  const filter = normalizeSearchEvent({ ...event, event: 'filter_apply', listing_id: 'listing_12345678',
    filter_key: 'options.Color', filter_value: 'Black', email: 'private@example.com' }, { shop, now });
  assert.equal(filter.filterKey, 'options.Color');
  assert.equal(filter.filterValue, 'Black');
  assert.equal(Object.hasOwn(filter, 'email'), false);
  assert.throws(() => normalizeSearchEvent({ ...event, shop: 'another.myshopify.com' }, { shop, now }));
  assert.throws(() => normalizeSearchEvent({ ...event, event: 'purchase' }, { shop, now }));
  assert.throws(() => normalizeSearchEvent({ ...event, ts: '2026-09-01T00:00:00Z' }, { shop, now }));
  assert.throws(() => normalizeSearchEventBatch([event, event], { shop, now }));
});

test('event ingestion accepts a bounded installed-shop batch and deduplicates retries', async () => {
  const source = await fs.readFile('app/routes/api.v2.events.jsx', 'utf8');
  const compiled = (await transform(source, { loader: 'jsx', format: 'cjs' })).code;
  const writes = [];
  const database = { session: { findFirst: async () => ({ id: 'offline' }) },
    searchAnalyticsEvent: { createMany: async input => { writes.push(input); return { count: input.data.length }; } } };
  const imports = { '../db.server.js': database,
    '../services/rateLimiter.server.js': { rateLimit: async () => true },
    '../utils/searchAnalytics.js': { normalizeSearchEventBatch } };
  const context = { module: { exports: {} }, exports: {}, require: name => {
    if (!(name in imports)) throw Error(`Unexpected import ${name}`);
    return imports[name];
  }, Response, Request, URL, Buffer, TextDecoder, console };
  vm.runInNewContext(compiled, context);
  const request = new Request(`https://example.test/api/v2/events?shop=${shop}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ ...event, ts: new Date().toISOString() }]) });
  const response = await context.module.exports.action({ request });
  assert.equal(response.status, 202);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].skipDuplicates, true);
  assert.equal(Object.hasOwn(writes[0].data[0], 'email'), false);
});
