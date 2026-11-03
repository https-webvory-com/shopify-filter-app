import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile('extensions/theme-extension/assets/moneyFormat.js', 'utf8');
function formatter(sample, currency = 'USD') {
  const window = {cfpMoneySample: sample, Shopify: {currency: {active: currency}}};
  vm.runInNewContext(source, {window, Intl, Number, String, document: {documentElement: {lang: 'en'}}});
  return window;
}

test('Shopify market money sample formats cards, quick view cents and popup units identically', () => {
  for (const [sample, amount, expected] of [
    ['Rs. 1,234,567.89 INR', 14600, 'Rs. 14,600.00 INR'],
    ['$1,234,567.89', 149, '$149.00'],
    ['£1,234,567.89 GBP', 115, '£115.00 GBP'],
    ['1.234.567,89 €', 149, '149,00 €'],
    ['¥1,234,568 JPY', 149, '¥149 JPY'],
    ['Rs. 12,34,567.89 INR', 14600, 'Rs. 14,600.00 INR'],
  ]) {
    const app = formatter(sample);
    assert.equal(app.cfpFormatMoney(amount), expected);
    assert.equal(app.cfpFormatMoneyCents(amount * 100), expected);
  }
});
