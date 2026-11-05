import test from 'node:test';
import assert from 'node:assert/strict';
import { extractQueryIntent } from '../../app/utils/queryIntent.js';

test('explicit price, size and occasion terms leave a useful lexical query', () => {
  assert.deepEqual(extractQueryIntent('red prom dress under $100 size 16w'), {
    residualQuery: 'red prom dress', price: { min: null, max: 100, maxExclusive: true },
    size: '16W', sortHint: null,
  });
  assert.deepEqual(extractQueryIntent('cheap prom dress'), {
    residualQuery: 'prom dress', price: null, size: null, sortHint: 'price-ascending',
  });
});

test('bounded ranges and lower limits are parsed without interpreting product codes', () => {
  assert.deepEqual(extractQueryIntent('gown between 50 and 100').price,
    { min: 50, max: 100, maxExclusive: false });
  assert.deepEqual(extractQueryIntent('gown at least £75').price,
    { min: 75, max: null, maxExclusive: false });
  assert.equal(extractQueryIntent('dress 1517').price, null);
  assert.equal(extractQueryIntent('under 0 dress').price, null);
});
