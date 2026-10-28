import client from '../app/services/meiliClient.server.js';
import { SEARCH_FILTER_FIELDS, SEARCH_PROJECTION_VERSION } from '../app/utils/searchIndexProjection.js';

const apply = process.argv.includes('--apply');
const index = client.index('products');
const settings = await index.getSettings();
const existing = settings.filterableAttributes || [];
const required = ['id', 'shop', 'status', 'title', 'createdAt', ...SEARCH_FILTER_FIELDS];
const missing = required.filter(field => !existing.includes('*') && !existing.includes(field));
const searchable = settings.searchableAttributes || ['*'];
const missingSearchable = searchable.includes('*') || searchable.includes('variantPrices') || searchable.includes('variantPrices.sku') ? [] : ['variantPrices.sku'];
console.log(JSON.stringify({ apply, missingFilterFields: missing, missingSearchableFields: missingSearchable }));
if ((missing.length || missingSearchable.length) && !apply) {
  console.log('Read-only check: run with --apply to add the missing filter/search fields. Existing settings and documents are preserved.');
  process.exitCode = 1;
} else {
  if (missing.length) {
    const task = await index.updateFilterableAttributes([...existing, ...missing]);
    const done = await client.tasks.waitForTask(task.taskUid, { timeout: 1200000 });
    if (done.status !== 'succeeded') throw Error('Search filter preparation failed: ' + (done.error?.code || done.status));
  }
  if (missingSearchable.length) {
    const task = await index.updateSearchableAttributes([...searchable, ...missingSearchable]);
    const done = await client.tasks.waitForTask(task.taskUid, { timeout: 1200000 });
    if (done.status !== 'succeeded') throw Error('SKU search preparation failed: ' + (done.error?.code || done.status));
  }
  for (const shop of ['thedressoutlet.myshopify.com', 'another-shpyfy-store.myshopify.com', 'collection-filter-pro.myshopify.com']) {
    const r = await index.search('', { filter: [`shop = ${JSON.stringify(shop)}`, "status = 'ACTIVE'",
      `NOT (cfpSearchVersion = ${SEARCH_PROJECTION_VERSION})`], hitsPerPage: 1, page: 0, attributesToRetrieve: [] });
    console.log(JSON.stringify({ shop, productsNeedingSync: r.totalHits, ready: r.totalHits === 0 }));
  }
  console.log('SKU lookup uses existing variantPrices.sku data; no product sync is required for the settings change. If productsNeedingSync is nonzero, native paging stays off for that shop until its search projection is updated.');
}
