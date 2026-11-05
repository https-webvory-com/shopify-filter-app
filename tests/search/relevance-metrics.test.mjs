import test from 'node:test';
import assert from 'node:assert/strict';
import { ndcgAt10, validateGoldenQueries } from '../../app/utils/relevanceMetrics.js';

test('relevance scoring rewards order and rejects an unjudged or duplicate golden set', () => {
  const grades = { '1': 3, '2': 2, '3': 1 };
  assert.equal(ndcgAt10(['1','2','3'], grades), 1);
  assert.ok(ndcgAt10(['3','2','1'], grades) < 1);
  assert.equal(ndcgAt10(['999'], grades), 0);
  assert.throws(() => ndcgAt10(['1','1'], grades), /Duplicate product/);
  const rows = Array.from({ length: 200 }, (_, index) => ({ store: 'US', query: `dress ${index}`, grades }));
  assert.equal(validateGoldenQueries(rows).length, 200);
  assert.throws(() => validateGoldenQueries(rows.slice(0, 199)), /exactly 200/);
  assert.throws(() => validateGoldenQueries([...rows.slice(0,199), rows[0]]), /Duplicate golden query/);
  assert.equal(validateGoldenQueries([{ store: 'UK', query: 'xyzqq', grades: {}, expectedZero: true }, ...rows.slice(1) ]).length, 200);
  assert.equal(validateGoldenQueries(rows.map((row,index)=>({shop:index<100?'toys.myshopify.com':'tools.myshopify.com',query:row.query,grades}))).length,200);
  assert.equal(validateGoldenQueries(rows.map(row=>({...row,country:'US'}))).length,200);
  assert.throws(()=>validateGoldenQueries(rows.map(row=>({...row,country:'usa'}))),/two-letter uppercase/);
  assert.throws(()=>validateGoldenQueries(rows.map(row=>({...row,shop:'invalid.example'})).map(row=>({shop:row.shop,query:row.query,grades}))),/Shopify shop/);
});
