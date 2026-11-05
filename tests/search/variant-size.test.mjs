import test from 'node:test';
import assert from 'node:assert/strict';
import { variantSizeEvidence } from '../../app/utils/variantSize.js';
import { rebuildSizeMappingPage, normalizedSizeSource } from '../../app/utils/sizeMappingRebuild.js';

test('every size variant has a numeric US size or an explicit review flag', () => {
  const options = [{ name: 'Size' }, { name: 'Color' }];
  const value = size => variantSizeEvidence(options, [{ name: 'Size', value: size }, { name: 'Color', value: 'Blue' }]);
  assert.deepEqual(value('16'), { sizeUsNumeric: 16, sizeMappingFlag: null });
  assert.deepEqual(value('16W'), { sizeUsNumeric: 16, sizeMappingFlag: 'WIDE_SIZE' });
  assert.deepEqual(value('XL'), { sizeUsNumeric: null, sizeMappingFlag: 'UNMAPPED_SIZE' });
  assert.deepEqual(variantSizeEvidence(options, [{ name: 'Size', value: 'XL' }], [{ sourceValue: 'XL', sizeUsNumeric: 18 }]),
    { sizeUsNumeric: 18, sizeMappingFlag: null });
  assert.deepEqual(variantSizeEvidence(options, [{ name: 'Color', value: 'Blue' }]),
    { sizeUsNumeric: null, sizeMappingFlag: 'NO_SIZE_OPTION' });
});

test('size mapping rebuild scopes reads to one store and updates existing variants', async () => {
  const calls = [];
  const job = { data: { shop: 'fixture.myshopify.com', cursor: null }, updateData: async value => { job.data = value; } };
  const database = {
    sizeNumericMapping: { findMany: async ({ where }) => { assert.equal(where.shop, job.data.shop); return [{ sourceValue: 'XL', sizeUsNumeric: 18 }]; } },
    variant: {
      findMany: async args => {
        assert.equal(args.where.product.shop, job.data.shop);
        return job.data.cursor ? [] : [{ id: 'variant-1', option1: 'XL', product: { options: [{ name: 'Size' }] } }];
      },
      update: args => { calls.push(args); return Promise.resolve(); },
    },
    $transaction: async updates => Promise.all(updates),
  };
  assert.deepEqual(await rebuildSizeMappingPage(job, database), { complete: true, processed: 1 });
  assert.deepEqual(calls[0].data, { sizeUsNumeric: 18, sizeMappingFlag: null });
  assert.equal(job.data.cursor, 'variant-1');
  assert.equal(normalizedSizeSource(' XL '), 'xl');
  await assert.rejects(rebuildSizeMappingPage({ data: { shop: 'other.example' } }, database), /Invalid size mapping shop/);
});
