import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const run = (command, args) => {
  const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || result.stdout || 'Database fixture failed');
};
let started = false, database;
try {
  run(process.execPath, ['tests/search-redirect/start-postgres.mjs']); started = true;
  const config = JSON.parse(await fs.readFile('scratch/redirect-db.json', 'utf8'));
  if (new URL(config.url).hostname !== '127.0.0.1' ||
      !path.resolve(config.directory).startsWith(path.resolve('scratch') + path.sep))
    throw Error('Refusing non-fixture database');
  process.env.DATABASE_URL = config.url;
  const { searchAnalyticsReport, analyticsRange, analyticsDashboard } = await import('../../app/services/searchAnalyticsReport.server.js');
  const { expireSearchAnalytics } = await import('../../app/services/searchAnalytics.server.js');
  run(path.join(config.bin, process.platform === 'win32' ? 'psql.exe' : 'psql'),
    ['-h', '127.0.0.1', '-p', String(config.port), '-U', 'fixture', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-f', 'prisma/migrations/20261030030000_search_analytics_events/migration.sql']);
  run(path.join(config.bin, process.platform === 'win32' ? 'psql.exe' : 'psql'),
    ['-h', '127.0.0.1', '-p', String(config.port), '-U', 'fixture', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-f', 'prisma/migrations/20261104000000_analytics_filter_labels/migration.sql']);
  database = new PrismaClient({ datasources: { db: { url: config.url } } });
  await database.$executeRaw`CREATE TABLE "Product" ("id" TEXT PRIMARY KEY, "shop" TEXT NOT NULL, "title" TEXT NOT NULL, "handle" TEXT NOT NULL)`;
  const shop = 'analytics-fixture.myshopify.com', other = 'other-analytics.myshopify.com';
  const now = new Date('2026-10-30T12:00:00Z');
  const add = async (eventId, tenant, event, searchId, query, hits, at = now, extra = {}) =>
    database.searchAnalyticsEvent.create({ data: { eventId, shop: tenant, event, at,
      anonId: `anon_${eventId}`, searchId, query, hits, ...extra } });
  await add('query-1', shop, 'search_query', 'search-1', 'blue dress', 10, now, { market: 'US' });
  await add('query-2', shop, 'search_query', 'search-2', 'blue dress', 0, now, { market: 'US' });
  await add('query-3', shop, 'search_query', 'search-3', 'red dress', 3);
  await add('click-1', shop, 'result_click', 'search-1', null, null, now, { productId: '123' });
  await add('click-2', shop, 'result_click', 'search-1', null, null);
  await add('cart-1', shop, 'add_to_cart', 'search-1', null, null);
  await add('filter-1', shop, 'filter_apply', 'search-1', null, null, now,
    { filterKey: 'options.Color', filterValue: 'Black' });
  await database.$executeRaw`INSERT INTO "Product" ("id", "shop", "title", "handle") VALUES ('gid://shopify/Product/123', ${shop}, 'Black dress', 'black-dress')`;
  await add('other-1', other, 'search_query', 'other-search', 'blue dress', 0);
  await add('expired-1', shop, 'search_query', 'old-search', 'old dress', 0,
    new Date('2025-01-01T12:00:00Z'));
  const report = await searchAnalyticsReport(shop, { database, now });
  assert.equal(report.summary.searches, 3);
  assert.equal(report.summary.zeroResults, 1);
  assert.equal(report.summary.clicks, 1);
  assert.equal(report.summary.cartAdds, 1);
  assert.equal(report.top[0].query, 'blue dress');
  assert.equal(report.top[0].searches, 2);
  assert.equal((await searchAnalyticsReport(other, { database, now })).summary.searches, 1);
  const range = (tab, group = 'day') => analyticsRange(new URLSearchParams({ tab, group, from: '2026-10-29', to: '2026-10-30' }), now);
  assert.throws(() => analyticsRange(new URLSearchParams({ from: '2026-02-30', to: '2026-10-30' }), now));
  assert.equal((await analyticsDashboard(shop, range('volume'), database)).rows[0].hits, 3);
  assert.equal((await analyticsDashboard(shop, range('queries'), database)).rows[0].label, 'blue dress');
  assert.equal((await analyticsDashboard(shop, range('filters'), database)).rows[0].label, 'Color - Black');
  assert.equal((await analyticsDashboard(shop, range('products'), database)).rows[0].label, 'Black dress');
  assert.equal((await analyticsDashboard(shop, range('locations'), database)).rows[0].hits, 2);
  assert.equal((await analyticsDashboard(shop, range('zero'), database)).rows[0].label, 'blue dress');
  assert.equal((await analyticsDashboard(shop, range('volume', 'hour_of_day'), database)).chart[0].bucket, '12');
  assert.equal((await analyticsDashboard(other, range('queries'), database)).rows[0].hits, 1);
  const retention = await expireSearchAnalytics(database, now);
  assert.equal(retention.deleted, 1);
  assert.equal(await database.searchAnalyticsEvent.count(), 8);
  console.log('PASS analytics migrations, six report tabs, tenant isolation, dashboard counts and 13-month retention');
} finally {
  await database?.$disconnect();
  if (started) run(process.execPath, ['tests/search-redirect/stop-postgres.mjs']);
}
