import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [ukSitemap, usSitemap, outputPath = 'data/relevance/search-queries-draft-200.csv'] = process.argv.slice(2);
if (!ukSitemap || !usSitemap) throw Error('Usage: node scripts/create-relevance-draft.mjs uk-collections.xml us-collections.xml [output.csv]');
const decode = value => value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const specs = [
  { store: 'UK', shop: 'thedressoutletuk.myshopify.com', country: 'UK',
    host: 'thedressoutlet.co.uk', file: ukSitemap },
  { store: 'US', shop: 'thedressoutlet.myshopify.com', country: 'US',
    host: 'www.thedressoutlet.com', file: usSitemap },
];
const challenges = [
  'promm dres', 'xyzqq', 'dress for wedding guest', 'red prom dress',
  'cheap prom dresses under 100', 'plus size', 'mob', 'purple prom dress',
  'navy mother of the bride dress', 'sage green dress', 'long sleeve formal dress',
  'petite evening dress', 'black cocktail dress', 'size 16 prom dress',
  'tulle dress', 'sequin gown', 'embroidered prom dress', 'blue dress size L',
  'wedding guest dress under 150', 'mother of the bride dresses sale',
];
const key = value => value.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
const score = row => createHash('sha256').update(row.query).digest('hex');
const csv = value => `"${String(value).replaceAll('"', '""')}"`;
const rows = ['store,shop,country,query,source,grade_status,expected_zero,required_relevant_hits'];
for (const spec of specs) {
  const xml = await fs.readFile(spec.file, 'utf8');
  const catalog = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, row]) => {
    const location = row.match(/<loc>(https:\/\/[^<]+\/collections\/[^<]+)<\/loc>/)?.[1];
    if (!location) return null;
    const source = decode(location);
    const url = new URL(source);
    if (url.hostname !== spec.host) return null;
    const handle = url.pathname.match(/^\/collections\/([^/]+)$/)?.[1];
    if (!handle) return null;
    const title = row.match(/<image:title>([^<]+)<\/image:title>/)?.[1];
    const query = decode(title || decodeURIComponent(handle).replaceAll('-', ' ')).replace(/\s+/g, ' ').trim();
    return { query, source };
  }).filter(Boolean).filter(row => row.query.length >= 8 && row.query.length <= 65 &&
    !/^(featured|sale|new arrivals|best sellers?|all products|clearance|shop all)$/i.test(row.query));
  const chosen = challenges.map(query => ({ query, source: 'roadmap/challenge' }));
  const seen = new Set(chosen.map(row => key(row.query)));
  for (const row of catalog.sort((a, b) => score(a).localeCompare(score(b)))) {
    if (chosen.length === 100) break;
    const normalized = key(row.query);
    if (seen.has(normalized)) continue;
    chosen.push(row); seen.add(normalized);
  }
  if (chosen.length !== 100) throw Error(`${spec.store} sitemap did not supply 100 distinct draft queries`);
  for (const row of chosen) rows.push([spec.store, spec.shop, spec.country, row.query, row.source,
    'unjudged', row.query === 'xyzqq' ? 'yes' : '', row.query === 'promm dres' ? '20' : ''].map(csv).join(','));
  console.log(`${spec.store}: ${catalog.length} eligible collection titles; 100 draft queries`);
}
await fs.mkdir(new URL('../data/relevance/', import.meta.url), { recursive: true });
await fs.writeFile(outputPath, rows.join('\n') + '\n');
console.log(`Prepared ${rows.length - 1} unjudged rows from merchant-specific catalogs`);
