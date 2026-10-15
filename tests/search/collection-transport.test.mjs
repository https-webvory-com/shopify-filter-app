import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { canStreamCollection, collectionRecords, collectionStreamResponse, compactCollectionFacets, packProducts } from '../../app/utils/collectionTransport.server.js';

const client = await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js', 'utf8');
const readerSource = client.slice(client.indexOf('  async function readCollectionStream('), client.indexOf('  async function takeEarlyCollectionResponse('));
function loadReader(timers = setTimeout) {
  const context = { TextDecoder, DOMException, setTimeout: timers, clearTimeout };
  vm.runInNewContext(readerSource, context);
  return context.readCollectionStream;
}
const read = loadReader();
const plain = value => JSON.parse(JSON.stringify(value));
const payload = {
  rankingToken: 'ordered-token', totalCount: 2, contextualPricingApplied: false,
  products: [{ id: '1', title: 'Été 👗', selectedVariantId: 'variant-2', images: ['image-a', 'image-b'],
    variants: Array.from({ length: 200 }, (_, i) => ({ id: 'variant-' + i, price: i === 0 ? 0 : '19.90', compareAtPrice: null,
      available: i % 2 === 0, option1: i % 2 ? 'Blue' : 'Bleu', ...(i % 3 ? { option2: '' } : {}), imageUrl: i % 2 ? 'image-a' : null })) },
    { id: '2', variants: [] }],
  settings: [], globalSettings: { quickViewEnabled: true }, mergedValues: [{ targetValue: 'Blue', sourceValues: ['Bleu'] }],
  facets: { tags: [{ value: 'Fabric_Silk', count: 4 }], options: { Color: [{ value: 'Blue', count: 2 }] }, priceRanges: { minLimit: 0, maxLimit: 19.9 } },
  debug: { collectionRankingStatus: 'ready' }, didYouMean: null,
};
function streamed(records, { fragment = 0, afterFirst, finish = true } = {}) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ async start(controller) {
    try {
      for (let i = 0; i < records.length; i++) {
        const bytes = encoder.encode(typeof records[i] === 'string' ? records[i] : JSON.stringify(records[i]) + '\n');
        if (fragment) for (let start = 0; start < bytes.length; start += fragment) controller.enqueue(bytes.slice(start, start + fragment));
        else controller.enqueue(bytes);
        if (i === 0 && afterFirst) await afterFirst;
      }
      if (finish) controller.close();
    } catch (error) { controller.error(error); }
  } }));
}
test('stream round trip preserves every product and variant field, zero prices, nulls, missing fields and Unicode', async () => {
  for (const fragment of [0, 1, 17, 1024]) {
    let callbacks = 0;
    const result = await read(streamed(collectionRecords(payload), { fragment }), new AbortController().signal, frame => {
      callbacks++; assert.deepEqual(plain(frame.products), payload.products);
    });
    assert.deepEqual(plain(result), payload); assert.equal(callbacks, 1);
  }
});
test('cards are available while filter metadata is still blocked', async () => {
  let release, seen;
  const waiting = new Promise(resolve => release = resolve);
  const first = new Promise(resolve => seen = resolve);
  let finished = false;
  const result = read(streamed(collectionRecords(payload), { afterFirst: waiting }), new AbortController().signal, seen).then(value => { finished = true; return value; });
  const frame = await first; assert.deepEqual(plain(frame.products), payload.products); assert.equal(finished, false);
  release(); assert.deepEqual(plain(await result), payload);
});
test('empty collections and products without variants retain their normal meaning', async () => {
  for (const products of [[], [{ id: 'no-variants' }], [{ id: 'many-fields', variants: [Object.fromEntries(Array.from({ length: 31 }, (_, i) => ['key' + i, i]))] }]]) {
    const value = { ...payload, products, totalCount: products.length };
    assert.deepEqual(plain(await read(streamed(collectionRecords(value)), new AbortController().signal)), value);
  }
});
test('malformed, reordered, duplicate or incomplete frames are rejected', async () => {
  const [first, last] = collectionRecords(payload);
  for (const records of [[], ['not-json\n'], [last, first], [first], [first, first, last], [first, last, last],
    [{ ...first, data: { ...first.data, products: null } }, last],
    [{ ...first, data: { ...first.data, totalCount: -1 } }, last],
    [{ ...first, data: { ...first.data, totalCount: 1.5 } }, last],
    [{ ...first, data: { ...first.data, products: [null] } }, last],
    [first, { ...last, data: { ...last.data, settings: null } }],
    [first, { ...last, data: { ...last.data, facets: [] } }],
    [first, { ...last, data: { ...last.data, products: [] } }],
    [{ type: 'unexpected', data: {} }],
    [{ ...first, data: { ...first.data, products: [{ __cfpVariantsV1: { keys: ['id'], rows: [[2, 'bad']] } }] } }, last],
    [{ ...first, data: { ...first.data, products: [{ __cfpVariantsV1: { keys: ['id'], rows: [[1]] } }] } }, last],
    [{ ...first, data: { ...first.data, products: [{ __cfpVariantsV1: { keys: ['id', 'id'], rows: [] } }] } }, last]]) {
    await assert.rejects(read(streamed(records), new AbortController().signal));
  }
});
test('abort before reading and while waiting for metadata cancels the stream without another callback', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(read(streamed(collectionRecords(payload)), before.signal), { name: 'AbortError' });
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode(JSON.stringify(collectionRecords(payload)[0]) + '\n')); }, cancel() { cancelled = true; } }));
  await assert.rejects(read(response, controller.signal, () => controller.abort()), { name: 'AbortError' });
  assert.equal(cancelled, true);
});
test('a stalled stream times out, cancels the body and releases its lock', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const bounded = loadReader((callback, ms) => setTimeout(callback, ms === 30000 ? 20 : ms));
  await assert.rejects(bounded(response, new AbortController().signal), /timed out/);
  assert.equal(cancelled, true); assert.equal(response.body.locked, false);
});
test('variant transport avoids prototype mutation and falls back for more than thirty columns', async () => {
  const variant = JSON.parse('{"__proto__":"safe","constructor":"own","price":0}');
  const value = { ...payload, products: [{ id: 'safe', variants: [variant] }] };
  const result = await read(streamed(collectionRecords(value)), new AbortController().signal);
  assert.deepEqual(plain(result), value); assert.equal({}.safe, undefined);
  assert.equal(packProducts([{ variants: [Object.fromEntries(Array.from({ length: 31 }, (_, i) => [i, i]))] }])[0].variants.length, 1);
});
test('compression negotiation preserves JSON data and prevents caching and proxy buffering', async () => {
  for (const [accept, encoding] of [['br, gzip', 'br'], ['br;q=0, gzip', 'gzip'], ['gzip;q=0', null], ['', null], ['*;q=0.5', 'br'], ['br;q=0,gzip;q=0,*;q=1', null]]) {
    const response = collectionStreamResponse(payload, new Request('https://fixture/api/filter', { headers: { 'accept-encoding': accept } }), { 'Access-Control-Allow-Origin': '*' });
    assert.equal(response.headers.get('content-encoding'), encoding);
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-accel-buffering'), 'no');
    assert.equal(response.headers.get('access-control-allow-origin'), '*'); assert.match(response.headers.get('vary'), /Accept-Encoding/);
    const bytes = Buffer.from(await response.arrayBuffer());
    const decoded = encoding === 'br' ? brotliDecompressSync(bytes) : encoding === 'gzip' ? gunzipSync(bytes) : bytes;
    assert.deepEqual(plain(await read(new Response(decoded), new AbortController().signal)), payload);
  }
});
test('only explicitly opted-in public unfiltered first collection pages use the new transport', () => {
  const url = 'https://fixture/api/filter?shop=fixture.myshopify.com&page=1&responseMode=stream-v1';
  const scope = { ranked: true, page: 1, filtered: false, customerTags: '', search: '' };
  assert.equal(canStreamCollection(new Request(url), scope), true);
  for (const change of [{ ranked: false }, { page: 2 }, { filtered: true }, { customerTags: 'VIP' }, { search: true }]) assert.equal(canStreamCollection(new Request(url), { ...scope, ...change }), false);
  for (const suffix of ['&minPrice=10', '&customer_tags=', '&isSearch=true', '&unknown=x', '&page=1']) assert.equal(canStreamCollection(new Request(url + suffix), scope), false);
  assert.equal(canStreamCollection(new Request(url.replace('stream-v1', 'future')), scope), false);
});
test('facet trimming preserves the union of prefixes, manual raw/stripped values, exclusions and counts', () => {
  const facets = { tags: [{ value: 'Sale', count: 5 }, { value: 'FABRIC_Silk', count: 3 }, { value: 'Fabric_Cotton', count: 0 }, { value: 'Fabric_Wool', count: 9 }, { value: 'Other', count: 2 }], options: { Color: ['Blue'] } };
  const settings = [
    { isEnabled: true, filterType: 'tags', config: { useManualValues: true, manualValues: [' sale '] } },
    { isEnabled: true, filterType: 'tag', config: JSON.stringify({ prefix: 'Fabric_', useManualValues: true, manualValues: ['silk', 'Fabric_Cotton'], excludedValues: ['Fabric_Wool'] }) },
    { isEnabled: false, filterType: 'tags', config: {} },
  ];
  assert.deepEqual(compactCollectionFacets(facets, settings), { ...facets, tags: facets.tags.slice(0, 3) });
  for (const config of [{}, { prefix: '' }, { useManualValues: true, manualValues: [] }, '{invalid']) {
    assert.deepEqual(compactCollectionFacets(facets, [{ isEnabled: true, filterType: 'tags', config }]), facets);
  }
});
