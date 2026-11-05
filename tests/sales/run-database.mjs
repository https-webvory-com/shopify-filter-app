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
  run(process.execPath, ['tests/search-redirect/start-postgres.mjs']);
  started = true;
  const config = JSON.parse(await fs.readFile('scratch/redirect-db.json', 'utf8'));
  if (new URL(config.url).hostname !== '127.0.0.1' ||
      !path.resolve(config.directory).startsWith(path.resolve('scratch') + path.sep))
    throw Error('Refusing non-fixture database');
  process.env.DATABASE_URL = config.url;
  database = new PrismaClient({ datasources: { db: { url: config.url } } });
  await database.$executeRawUnsafe(`CREATE TABLE "Product" (
    id text PRIMARY KEY, shop text NOT NULL,
    "unitsLifetime" integer NOT NULL DEFAULT 0,
    "unitsSold60Days" integer NOT NULL DEFAULT 0,
    "unitsSold7Days" integer NOT NULL DEFAULT 0,
    "grossRevenue" double precision NOT NULL DEFAULT 0,
    "orderCount" integer NOT NULL DEFAULT 0,
    "bestSellingScore" double precision NOT NULL DEFAULT 0,
    "trendingScore" double precision NOT NULL DEFAULT 0,
    "updatedAt" timestamp NOT NULL DEFAULT NOW()
  )`);
  await database.$executeRawUnsafe(`INSERT INTO "Product" (id, shop, "bestSellingScore")
    VALUES ('one','shop-a.myshopify.com',9),('two','shop-a.myshopify.com',8),
      ('other','shop-b.myshopify.com',7)`);
  const { replaceSalesMetrics } = await import('../../app/services/salesMetrics.server.js');
  const stats = { unitsLifetime: 12, unitsSold60Days: 4, unitsSold7Days: 2,
    revenueLifetime: 37.5, orderCount: 3 };
  assert.equal(await replaceSalesMetrics('shop-a.myshopify.com', { one: stats }, database), 2);
  const rows = await database.$queryRawUnsafe(`SELECT id, "bestSellingScore" AS score,
    "grossRevenue" AS revenue FROM "Product" ORDER BY id`);
  assert.deepEqual(rows.map(row => [row.id, row.score, row.revenue]),
    [['one', 12, 37.5], ['other', 7, 0], ['two', 0, 0]]);
  await assert.rejects(replaceSalesMetrics('shop-a.myshopify.com',
    { one: { ...stats, unitsLifetime: 'invalid' } }, database));
  const after = await database.$queryRawUnsafe(`SELECT id, "bestSellingScore" AS score
    FROM "Product" ORDER BY id`);
  assert.deepEqual(after.map(row => [row.id, row.score]),
    [['one', 12], ['other', 7], ['two', 0]]);
  console.log('PASS atomic sales scores, zero default, tenant isolation, failed statement preserves prior scores');
} finally {
  await database?.$disconnect();
  if (started) run(process.execPath, ['tests/search-redirect/stop-postgres.mjs']);
}
