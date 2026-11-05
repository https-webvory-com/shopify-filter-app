import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [sitemapPath, outputPath = 'data/relevance/search-queries-draft-200.csv'] = process.argv.slice(2);
if (!sitemapPath) throw Error('Usage: node scripts/create-relevance-draft.mjs uk-collections-sitemap.xml [output.csv]');
const xml = await fs.readFile(sitemapPath, 'utf8');
const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const catalog = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, row]) => {
  const path = row.match(/<loc>https:\/\/thedressoutlet\.co\.uk\/collections\/([^<]+)<\/loc>/)?.[1];
  if (!path) return null;
  const title = row.match(/<image:title>([^<]+)<\/image:title>/)?.[1];
  const query = decode(title || decodeURIComponent(path).replaceAll('-', ' ')).replace(/\s+/g, ' ').trim();
  return { query, source: `https://thedressoutlet.co.uk/collections/${path}` };
}).filter(Boolean).filter(row => row.query.length >= 8 && row.query.length <= 65 &&
  !/^(featured|sale|new arrivals|best sellers?|all products|clearance|shop all)$/i.test(row.query));
const challenges = [
  'promm dres', 'xyzqq', 'dress for wedding guest', 'red prom dress',
  'cheap prom dresses under 100', 'plus size', 'mob', 'purple prom dress',
  'navy mother of the bride dress', 'sage green dress', 'long sleeve formal dress',
  'petite evening dress', 'black cocktail dress', 'size 16 prom dress',
  'tulle dress', 'sequin gown', 'embroidered prom dress', 'blue dress size L',
  'wedding guest dress under 150', 'mother of the bride dresses sale',
];
const key = value => value.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
const chosen = challenges.map(query => ({ query, source: 'roadmap/challenge' }));
const seen = new Set(chosen.map(row => key(row.query)));
const score = row => createHash('sha256').update(row.query).digest('hex');
for (const row of catalog.sort((a, b) => score(a).localeCompare(score(b)))) {
  if (chosen.length === 100) break;
  const normalized = key(row.query);
  if (seen.has(normalized)) continue;
  chosen.push(row); seen.add(normalized);
}
if (chosen.length !== 100) throw Error('Collection sitemap did not supply 100 distinct draft queries');
const csv = value => `"${String(value).replaceAll('"', '""')}"`;
const rows = ['store,query,source,grade_status,expected_zero,required_relevant_hits'];
for (const store of ['UK', 'US']) for (const row of chosen)
  rows.push([store, row.query, row.source, 'unjudged', row.query === 'xyzqq' ? 'yes' : '',
    row.query === 'promm dres' ? '20' : ''].map(csv).join(','));
await fs.mkdir(new URL('../data/relevance/', import.meta.url), { recursive: true });
await fs.writeFile(outputPath, rows.join('\n') + '\n');
console.log(`Prepared ${rows.length - 1} unjudged query rows from ${catalog.length} public UK collection titles and ${challenges.length} challenge terms.`);
