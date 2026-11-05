import fs from 'node:fs/promises';
import Papa from 'papaparse';

const input = process.argv[2] || 'data/relevance/search-queries-draft-200.csv';
const output = process.argv[3] || 'data/relevance/product-grades-review-200.csv';
const base = new URL(process.argv[4] || 'https://aisearchfilter.webvory.com');
if (base.protocol !== 'https:') throw Error('Relevance candidates require an HTTPS API');
const parsed = Papa.parse(await fs.readFile(input, 'utf8'), { header: true, skipEmptyLines: true });
if (parsed.errors.length) throw Error(`Invalid query CSV: ${parsed.errors[0].message}`);
const queries = parsed.data;
if (queries.length !== 200 || queries.some(row => !row.store || !row.query))
  throw Error('Expected 200 store-specific draft queries');
const shops = { UK: 'thedressoutletuk.myshopify.com', US: 'thedressoutlet.myshopify.com' };
const shopFor = row => row.shop || shops[row.store];
const countryFor = row => {
  const country = row.country || (row.store === 'UK' ? 'GB' : row.store === 'US' ? 'US' : '');
  return country === 'UK' ? 'GB' : country;
};
if (queries.some(row => !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopFor(row) || '')))
  throw Error('Each draft query needs a valid Shopify shop domain');
if (queries.some(row => countryFor(row) && !/^[A-Z]{2}$/.test(countryFor(row))))
  throw Error('Each country must be a two-letter uppercase code');
try {
  const existing = Papa.parse(await fs.readFile(output, 'utf8'), { header: true, skipEmptyLines: true });
  if (existing.errors.length) throw Error(`Invalid existing review CSV: ${existing.errors[0].message}`);
  if (existing.data.some(row => String(row.reviewed_grade || '').trim()))
    throw Error(`Refusing to overwrite reviewed grades in ${output}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const normalize = value => String(value || '').toLowerCase().normalize('NFKD')
  .replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tokens = value => [...new Set(normalize(value).split(' ').filter(word =>
  word.length > 2 && !['the', 'for', 'with', 'and', 'under', 'less', 'than', 'size'].includes(word)))];
const propose = (query, product) => {
  const wanted = tokens(query).map(token => token === 'promm' ? 'prom' : token === 'dres' ? 'dress' : token);
  const title = normalize(product.title);
  if (!wanted.length) return { grade: 0, reason: 'No title terms; review required' };
  const matched = wanted.filter(token => title.includes(token)).length;
  const ratio = matched / wanted.length;
  if (/\bguest\b/i.test(query) && /\bbridal\b/i.test(product.title))
    return { grade: 0, reason: 'Guest query conflicts with bridal title' };
  const grade = ratio === 1 ? 3 : ratio >= 0.66 ? 2 : ratio >= 0.33 ? 1 : 0;
  return { grade, reason: `${matched}/${wanted.length} query terms in title; human review required` };
};
const csv = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const records = [['store', 'shop', 'country', 'query', 'query_source', 'product_id', 'product_title',
  'product_handle', 'product_type', 'response_price_min', 'candidate_source', 'result_rank',
  'candidate_grade', 'reviewed_grade', 'candidate_reason']];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const search = async (shop, query, limit, country) => {
  const url = new URL('/api/search', base);
  for (const [key, value] of Object.entries({ shop, q: query, limit: String(limit), suggestionLimit: '0' }))
    url.searchParams.set(key, value);
  if (country) url.searchParams.set('country', country);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (response.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!response.ok) throw Error(`Search ${shop} HTTP ${response.status} for ${query}`);
    const body = await response.json();
    if (!Array.isArray(body.products)) throw Error('Search response missing products');
    return body.products;
  }
  throw Error(`Search rate limited for ${shop}`);
};
let completed = 0;
for (const row of queries) {
  const shop = shopFor(row);
  const country = countryFor(row);
  const isZero = row.expected_zero === 'yes';
  const products = isZero ? [] : await search(shop, row.query, row.required_relevant_hits ? 100 : 10, country);
  const originalCount = products.length;
  if (!isZero && row.required_relevant_hits && products.length < 20) {
    const fallback = await search(shop, row.query === 'promm dres' ? 'prom dress' : row.query, 30, country);
    const seen = new Set(products.map(product => product.id));
    for (const product of fallback) if (!seen.has(product.id)) { products.push(product); seen.add(product.id); }
  }
  if (isZero || !products.length) records.push([row.store, shop, country, row.query, row.source, '', '', '', '', '', '', '', '', '',
    isZero ? 'Expected zero results; verify suggestions' : 'No current results; review query']);
  else products.forEach((product, index) => {
    const proposal = propose(row.query, product);
    records.push([row.store, shop, country, row.query, row.source, String(product.id || '').split('/').pop(),
      product.title || '', product.handle || '', product.productType || '', product.priceMin ?? '',
      index < originalCount ? 'query' : 'fallback', index < originalCount ? index + 1 : '',
      proposal.grade, '', proposal.reason]);
  });
  completed++;
  if (completed % 20 === 0) console.log(`Candidate queries prepared: ${completed}/200`);
  await sleep(100);
}
await fs.writeFile(output, records.map(row => row.map(csv).join(',')).join('\n') + '\n');
console.log(`Wrote ${records.length - 1} candidate rows to ${output}; reviewed_grade is intentionally blank.`);
