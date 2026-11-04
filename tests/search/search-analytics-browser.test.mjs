import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

test('browser analytics waits for Shopify analytics consent and emits anonymous batches', async () => {
  const listeners = new Map(), sent = [], fetched = [];
  let consent = false, cookie = '';
  const document = { documentElement: {},
    get cookie() { return cookie; }, set cookie(value) { cookie = value; },
    addEventListener(name, fn) { listeners.set(name, fn); } };
  const window = { Shopify: { shop: 'example.myshopify.com', country: 'US', locale: 'en',
    customerPrivacy: { analyticsProcessingAllowed: () => consent } },
    addEventListener(name, fn) { listeners.set(name, fn); } };
  const session = new Map();
  const sessionStorage = { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value) };
  const navigator = { sendBeacon: (url, body) => { sent.push({ url, body }); return true; } };
  const source = await fs.readFile('extensions/theme-extension/assets/searchAnalytics.js', 'utf8');
  vm.runInNewContext(source, { window, document, navigator, sessionStorage,
    crypto: webcrypto, URL, Blob, Date, Uint8Array, Array, setInterval() {}, setTimeout() {},
    fetch: async (url, options) => { fetched.push({ url, options }); return { ok: true }; } });
  const searchId = window.CfpAnalytics.newSearchId();
  assert.equal(window.CfpAnalytics.track('search_query', { search_id: searchId, q: 'blue dress' }), false);
  assert.equal(sent.length, 0);
  assert.equal(cookie, '');
  consent = true; listeners.get('visitorConsentCollected')();
  assert.equal(window.CfpAnalytics.track('search_query', { search_id: searchId, q: 'blue dress' }), true);
  await window.CfpAnalytics.flush();
  assert.equal(fetched.length, 1);
  const events = JSON.parse(fetched[0].options.body);
  assert.equal(events[0].q, 'blue dress');
  assert.match(events[0].anon_id, /^anon_[a-f0-9]{32}$/);
  assert.equal(Object.hasOwn(events[0], 'email'), false);
  window.CfpAnalytics.track('zero_result', { search_id: searchId });
  listeners.get('pagehide')();
  assert.equal(sent.length, 1);
  consent = false; listeners.get('visitorConsentCollected')();
  assert.equal(window.CfpAnalytics.track('search_query', { search_id: searchId, q: 'red dress' }), false);
});
