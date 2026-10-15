import assert from 'node:assert/strict';
import { db, service, shop, sql, api } from './layer.mjs';
import { DEFAULT_SEARCH_SETTINGS as defaults } from '../../app/utils/searchSettings.js';
try {
  sql(['-f', 'prisma/migrations/20261015010000_search_settings/migration.sql']);
  assert.equal(await service.getSearchSettings(shop), null);
  await service.saveSearchSettings(shop, { ...defaults, pageSize: 12 });
  await service.saveSearchSettings('second-settings-fixture.myshopify.com', { ...defaults, pageSize: 8 });
  assert.equal((await service.getSearchSettings(shop)).pageSize, 12);
  await service.saveSearchSettings(shop, { ...defaults, pageSize: 4 });
  assert.equal((await service.getSearchSettings(shop)).pageSize, 4);
  console.log('PASS actual migration and fresh persisted create/update reads');
  await assert.rejects(service.saveSearchSettings(shop, { ...defaults, pageSize: 0 }));
  assert.equal((await service.getSearchSettings(shop)).pageSize, 4);
  await service.resetSearchSettings(shop);
  assert.equal(await service.getSearchSettings(shop), null);
  assert.equal((await service.getSearchSettings('second-settings-fixture.myshopify.com')).pageSize, 8);
  console.log('PASS validation preserves saved values; reset and tenant isolation');
  sql(['-c', 'ALTER TABLE "SearchSetting" RENAME TO "SearchSettingOffline"']);
  try {
    const result = await api.loader({ request: new Request('https://fixture/api/search-settings?shop=' + shop) });
    assert.deepEqual(await result.json(), { settings: null });
    console.log('PASS real database failure falls back to storefront defaults');
  } finally { sql(['-c', 'ALTER TABLE "SearchSettingOffline" RENAME TO "SearchSetting"']); }
} finally {
  await db.$disconnect();
}
