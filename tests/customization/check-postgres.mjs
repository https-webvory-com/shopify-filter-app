import assert from 'node:assert/strict';
import { db, shop, service, sql, api, admin } from './layer.mjs';
import { DEFAULT_CUSTOMIZATION as defaults } from '../../app/utils/customization.js';
try {
  sql(['-f', 'prisma/migrations/20261015020000_theme_customization/migration.sql']);
  await service.saveCustomization(shop, '1', { ...defaults, enabled: true, css: '.cfp-filter-title{color:red}', javascript: 'window.customizationCount = 1;', javascriptEnabled: true, swatches: [{ color: ' Navy  Blue ', hex: '#123456' }] });
  assert.equal((await service.getCustomization(shop, '1')).swatches[0].color, 'Navy Blue');
  const request = (id = '1', suffix = '') => ({ request: new Request('https://fixture/api/customization?shop=' + shop + '&themeId=' + id + suffix) });
  assert.equal((await (await api.loader(request())).json()).customization.javascriptEnabled, true);
  assert.match(await (await api.loader(request('1', '&asset=javascript'))).text(), /window.customizationCount/);
  console.log('PASS actual migration, saved theme CSS/JS/swatches, fresh public JSON and executable asset');
  await service.saveCustomization(shop, '2', { ...defaults, css: 'second' });
  await service.saveCustomization('other-customization-fixture.myshopify.com', '1', { ...defaults, css: 'other' });
  await service.resetCustomization(shop, '1');
  assert.equal(await service.getCustomization(shop, '1'), null);
  assert.equal((await service.getCustomization(shop, '2')).css, 'second');
  assert.equal((await service.getCustomization('other-customization-fixture.myshopify.com', '1')).css, 'other');
  assert.equal((await (await api.loader(request('2'))).json()).customization, null);
  console.log('PASS shop/theme isolation, per-theme reset and disabled defaults');
  await service.saveCustomization(shop, '1', { ...defaults, css: 'last-good' });
  await assert.rejects(service.saveCustomization(shop, '1', { ...defaults, javascript: 'function (' }), /syntax/);
  assert.equal((await service.getCustomization(shop, '1')).css, 'last-good');
  const result = await admin.action({ request: new Request('https://fixture/admin', { method: 'POST', body: new URLSearchParams({ intent: 'reset', themeId: '999' }) }) });
  assert.match(result.error, /no longer exists/);
  console.log('PASS failed edit preserves last-good record and foreign/deleted themes cannot be mutated');
  sql(['-c', 'ALTER TABLE "ThemeCustomization" RENAME TO "ThemeCustomizationOffline"']);
  try {
    assert.deepEqual(await (await api.loader(request())).json(), { customization: null });
    assert.equal(await (await api.loader(request('1', '&asset=javascript'))).text(), '');
  } finally { sql(['-c', 'ALTER TABLE "ThemeCustomizationOffline" RENAME TO "ThemeCustomization"']); }
  console.log('PASS actual missing-table fallback preserves storefront availability');
} finally {
  await db.themeCustomization.deleteMany({ where: { shop: { in: [shop, 'other-customization-fixture.myshopify.com'] } } });
  await db.$disconnect();
}
