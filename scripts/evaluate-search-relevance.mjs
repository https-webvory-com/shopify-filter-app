import fs from 'node:fs/promises';
import { ndcgAt10, validateGoldenQueries } from '../app/utils/relevanceMetrics.js';

const [file, baseUrl] = process.argv.slice(2);
if (!file || !baseUrl) throw Error('Usage: node scripts/evaluate-search-relevance.mjs golden.json https://api.example');
const base = new URL(baseUrl);
if (base.protocol !== 'https:' && base.hostname !== 'localhost') throw Error('Search API URL must use HTTPS');
const rows = validateGoldenQueries(JSON.parse(await fs.readFile(file, 'utf8')));
const stores = { US: 'thedressoutlet.myshopify.com', UK: 'thedressoutletuk.myshopify.com' };
const results = [];
for (const row of rows) {
  const url = new URL('/api/search', base);
  const shop = row.shop || stores[row.store];
  url.searchParams.set('shop', shop);
  const country = row.country || (['UK', 'US'].includes(row.store) ? row.store : null);
  if (country) url.searchParams.set('country', country);
  url.searchParams.set('q', row.query);
  url.searchParams.set('limit', row.requiredRelevantHits ? '100' : '10');
  url.searchParams.set('suggestionLimit', row.expectedZero ? '5' : '0');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Search failed for ${shop}: HTTP ${response.status}`);
  const body = await response.json();
  const ids = (body.products || []).map(product => product.id);
  if (row.expectedZero) {
    results.push({ store: row.store, query: row.query, expectedZero: true,
      zeroResultMet: ids.length === 0, suggestionsMet: (body.suggestions || []).length > 0, ids });
  } else {
    const relevantHits = ids.filter(id => Number(row.grades[String(id).split('/').pop()] || 0) > 0).length;
    results.push({ store: row.store, query: row.query, score: ndcgAt10(ids, row.grades),
      ...(row.requiredRelevantHits ? { relevantHits, requiredRelevantHits: row.requiredRelevantHits } : {}), ids });
  }
}
const scored = results.filter(row => Number.isFinite(row.score));
const mean = scored.reduce((sum, row) => sum + row.score, 0) / scored.length;
const specialChecksMet = results.every(row => row.expectedZero ? row.zeroResultMet && row.suggestionsMet :
  !row.requiredRelevantHits || row.relevantHits >= row.requiredRelevantHits);
console.log(JSON.stringify({ queries: results.length, scoredQueries: scored.length, ndcgAt10: mean,
  targetMet: mean >= 0.8 && specialChecksMet, specialChecksMet,
  weakest: scored.toSorted((a,b) => a.score-b.score).slice(0, 20),
  special: results.filter(row => row.expectedZero || row.requiredRelevantHits) }, null, 2));
if (mean < 0.8 || !specialChecksMet) process.exitCode = 1;
