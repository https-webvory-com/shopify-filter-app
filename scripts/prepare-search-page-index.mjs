import client from '../app/services/meiliClient.server.js';
import { SEARCH_FILTER_FIELDS, SEARCH_PROJECTION_VERSION } from '../app/utils/searchIndexProjection.js';

const apply = process.argv.includes('--apply');
const index = client.index('products');
const settings = await index.getSettings();
const existing = settings.filterableAttributes || [];
const required = ['id', 'shop', 'status', 'title', 'createdAt', ...SEARCH_FILTER_FIELDS];
const missing = required.filter(field => !existing.includes('*') && !existing.includes(field));
console.log(JSON.stringify({ apply, missingFilterFields: missing }));
if (missing.length && !apply) {
  console.log('Read-only check: run with --apply to add the missing filter fields. Existing settings and documents are preserved.');
  process.exitCode = 1;
} else {
  if (missing.length) {
    const task = await index.updateFilterableAttributes([...existing, ...missing]);
    const done = await client.tasks.waitForTask(task.taskUid, { timeout: 1200000 });
    if (done.status !== 'succeeded') throw Error('Search filter preparation failed: ' + (done.error?.code || done.status));
  }
  for (const shop of ['thedressoutlet.myshopify.com', 'another-shpyfy-store.myshopify.com', 'collection-filter-pro.myshopify.com']) {
    const r = await index.search('', { filter: [`shop = ${JSON.stringify(shop)}`, "status = 'ACTIVE'",
      `NOT (cfpSearchVersion = ${SEARCH_PROJECTION_VERSION})`], hitsPerPage: 1, page: 0, attributesToRetrieve: [] });
    console.log(JSON.stringify({ shop, productsNeedingSync: r.totalHits, ready: r.totalHits === 0 }));
  }
  console.log('Run the normal product sync after deploying this backend. Native paging stays off for a shop until all active documents carry the new projection.');
}
