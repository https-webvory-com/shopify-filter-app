import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCacheHeaders } from '../../app/utils/searchCachePolicy.js';

test('shared search cache is bounded to anonymous URL context', () => {
  const url = 'https://app.test/api/search?shop=one.myshopify.com&country=GB&locale=en-GB&q=red';
  const publicHeaders = searchCacheHeaders(new Request(url));
  assert.equal(publicHeaders['Cache-Control'], 'public, max-age=0, s-maxage=60');
  assert.equal(publicHeaders['CDN-Cache-Control'], 'public, max-age=60');
  assert.equal(searchCacheHeaders(new Request(url + '&customer_tags=vip'))['Cache-Control'], 'private, no-store');
  assert.equal(searchCacheHeaders(new Request(url, { headers: { Authorization: 'Bearer token' } }))['Cache-Control'], 'private, no-store');
});
