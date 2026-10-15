import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { PrismaClient } from '../../scratch/banner-prisma/index.js';
import { loadModule } from '../search/helpers/search-ranking.mjs';
import * as conditions from '../../app/utils/merchandisingCondition.js';
import * as helpers from '../../app/utils/csvImportReport.js';
const config = JSON.parse(await fs.readFile('scratch/redirect-db.json', 'utf8'));
if (new URL(config.url).hostname !== '127.0.0.1' || Number(new URL(config.url).port) !== config.port || !path.resolve(config.directory).startsWith(path.resolve('scratch') + path.sep)) throw Error('CSV tests require an isolated local database');
const db = new PrismaClient({ datasources: { db: { url: config.url } } });
await db.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
const setup = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--schema', 'scratch/banner-schema.prisma', '--skip-generate', '--accept-data-loss'], { env: { ...process.env, DATABASE_URL: config.url }, windowsHide: true, stdio: 'inherit' });
if (setup.status !== 0) throw Error('Could not prepare the isolated import schema');
const shop = 'csv-report-fixture.myshopify.com';
let failAfterUpdate = false;
const service = await loadModule('app/services/merchandisingImport.server.js', {
  '../utils/merchandisingCondition.js': conditions, '../utils/csvImportReport.js': helpers,
  '../db.server': { default: { $transaction: fn => db.$transaction(tx => fn({ merchandisingRule: {
    findFirst: value => tx.merchandisingRule.findFirst(value), create: value => tx.merchandisingRule.create(value),
    update: async value => { const result = await tx.merchandisingRule.update(value); if (failAfterUpdate) throw Object.assign(Error('Injected failure after the actual SQL update'), { code: 'P2000' }); return result; },
  } })) } },
});
const rule = (name, extra = {}) => ({ name, sourceRow: 2, collections: ['Summer'], conditions: [{ action: 'Boost', field: 'Tags', value: 'Summer' }], ...extra });
try {
  const report = await service.importMerchandisingRules(shop, [rule('same'), rule('invalid', { conditions: [] }), rule('after bad row')], 'collection');
  assert.equal(report.imported, 2); assert.equal(report.skipped, 1);
  assert.equal(await db.merchandisingRule.count({ where: { shop } }), 2);
  console.log('PASS real PostgreSQL partial import persists valid rules and reports invalid rows');
  await service.importMerchandisingRules(shop, [rule('same')], 'search');
  const before = await db.merchandisingRule.findFirst({ where: { shop, name: 'same', ruleType: 'collection' }, include: { conditions: true } });
  failAfterUpdate = true;
  const failed = await service.importMerchandisingRules(shop, [rule('same', { conditions: [{ action: 'Bury', field: 'Tags', value: 'Clearance' }] })], 'collection');
  failAfterUpdate = false;
  assert.equal(failed.skipped, 1);
  const after = await db.merchandisingRule.findUnique({ where: { id: before.id }, include: { conditions: true } });
  assert.deepEqual(after, before);
  console.log('PASS real transaction rollback preserves original rule AND conditions after an actual SQL update');
  const updated = await service.importMerchandisingRules(shop, [rule('same', { conditions: [{ action: 'Boost', field: 'Price', minValue: 0, maxValue: 100 }] })], 'collection');
  assert.equal(updated.imported, 1); assert.equal(updated.warnings.length, 1);
  const saved = await db.merchandisingRule.findUnique({ where: { id: before.id }, include: { conditions: true } });
  assert.equal(saved.conditions[0].minValue, '0'); assert.equal(saved.conditions[0].maxValue, '100');
  const search = await db.merchandisingRule.findFirst({ where: { shop, name: 'same', ruleType: 'search' }, include: { conditions: true } });
  assert.equal(search.conditions[0].field, 'Tags');
  console.log('PASS same-name search/collection isolation, successful update warning and numeric bounds');
} finally { await db.merchandisingRule.deleteMany({ where: { shop } }); await db.$disconnect(); }
