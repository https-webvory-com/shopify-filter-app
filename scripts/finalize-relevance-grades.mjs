import fs from 'node:fs/promises';
import Papa from 'papaparse';
import { validateGoldenQueries } from '../app/utils/relevanceMetrics.js';

const [reviewFile = 'data/relevance/product-grades-review-200.csv',
  queryFile = 'data/relevance/search-queries-draft-200.csv',
  outputFile = 'data/relevance/golden-200.json'] = process.argv.slice(2);
const read = async file => {
  const result = Papa.parse(await fs.readFile(file, 'utf8'), { header: true, skipEmptyLines: true });
  if (result.errors.length) throw Error(`Invalid CSV ${file}: ${result.errors[0].message}`);
  return result.data;
};
const reviews = await read(reviewFile), queries = await read(queryFile);
const key = row => `${row.store}:${row.query.trim().toLowerCase()}`;
const grouped = new Map();
for (const row of reviews) grouped.set(key(row), [...(grouped.get(key(row)) || []), row]);
const golden = queries.map(query => {
  const rows = grouped.get(key(query)) || [];
  if (!rows.length) throw Error(`No candidate rows for ${key(query)}`);
  const grades = {};
  for (const row of rows) {
    if (!row.product_id) continue;
    if (!/^[0-3]$/.test(row.reviewed_grade))
      throw Error(`Review grade 0-3 is required for ${key(query)} product ${row.product_id}`);
    if (Object.hasOwn(grades, row.product_id)) throw Error(`Duplicate candidate ${row.product_id}`);
    grades[row.product_id] = Number(row.reviewed_grade);
  }
  const expectedZero = query.expected_zero === 'yes';
  if (!expectedZero && !Object.values(grades).some(grade => grade > 0))
    throw Error(`At least one relevant product must be reviewed for ${key(query)}`);
  if (expectedZero && Object.values(grades).some(grade => grade > 0))
    throw Error(`Zero-result query has relevant products: ${key(query)}`);
  const rawCountry = rows[0].country || query.country || (query.store === 'UK' ? 'GB' : query.store === 'US' ? 'US' : undefined);
  return { store: query.store, shop: rows[0].shop,
    country: rawCountry === 'UK' ? 'GB' : rawCountry,
    query: query.query, grades,
    ...(expectedZero ? { expectedZero: true } : {}),
    ...(query.required_relevant_hits ? { requiredRelevantHits: Number(query.required_relevant_hits) } : {}) };
});
validateGoldenQueries(golden);
await fs.writeFile(outputFile, JSON.stringify(golden, null, 2) + '\n');
console.log(`Wrote ${golden.length} reviewed queries to ${outputFile}`);
