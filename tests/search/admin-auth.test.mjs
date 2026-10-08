import test from 'node:test';
import assert from 'node:assert/strict';
import { installAdminFetch } from '../../app/utils/adminFetch.js';

function browserFixture() {
  const calls = []; let issued = 0;
  const browser = { location: { origin: 'https://app.example', href: 'https://app.example/app' }, setTimeout,
    shopify: { idToken: async () => 'token-' + ++issued },
    fetch: async (input, init) => { const request = input instanceof Request ? input : new Request(new URL(input, 'https://app.example'), init); calls.push(request); return new Response('{}'); } };
  installAdminFetch(browser); return { browser, calls };
}

test('admin navigation obtains a fresh token even without shop/host URL parameters', async () => {
  const { browser, calls } = browserFixture();
  await browser.fetch('/app/collections/pinning.data?index=');
  await browser.fetch('/app/search/pinning.data');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer token-1');
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer token-2');
});

test('authenticated actions retain their method, body and existing headers', async () => {
  const { browser, calls } = browserFixture();
  await browser.fetch('/api/import-pins-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"rows":[]}' });
  assert.equal(calls[0].method, 'POST'); assert.equal(await calls[0].text(), '{"rows":[]}');
  assert.equal(calls[0].headers.get('Content-Type'), 'application/json');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer token-1');
});

test('tokens are never attached to foreign hosts, public storefront endpoints or login requests', async () => {
  const { browser, calls } = browserFixture();
  for (const path of ['https://other.example/app/data', '/api/filter', '/auth/login']) await browser.fetch(path);
  for (const request of calls) assert.equal(request.headers.get('Authorization'), null);
});

test('existing explicit authorization is preserved', async () => {
  const { browser, calls } = browserFixture();
  await browser.fetch(new Request('https://app.example/app.data', { headers: { Authorization: 'Bearer supplied-token' } }));
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer supplied-token');
});
