import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile('extensions/theme-extension/assets/instantSearch.js', 'utf8');
const start = source.indexOf('      let price = "";');
const end = source.indexOf('      let productUrl', start);
assert.ok(start >= 0 && end > start, 'The instant card price path must be present');
const renderPrice = source.slice(start, end) + '\nresult = price;';

test('instant search passes the already-localized amount to the shop formatter', () => {
  for (const amount of [2450, 1025, 885.95, 2111]) {
    const received = [];
    const context = {
      p: {priceMin: amount}, result: null, Intl,
      window: {cfpFormatMoney(value) {received.push(value); return `formatted:${value}`;}},
    };
    vm.runInNewContext(renderPrice, context);
    assert.deepEqual(received, [amount]);
    assert.equal(context.result, `formatted:${amount}`);
  }
});

test('instant search never applies a second currency conversion rate', () => {
  const context = {
    p: {priceMin: 10}, rate: 83.5, result: null, Intl,
    window: {cfpFormatMoney: amount => `formatted:${amount}`},
  };
  vm.runInNewContext(renderPrice, context);
  assert.equal(context.result, 'formatted:10');
});
