// Read-only offline comparison; does not connect to Shopify, the DB or the index.
import fs from 'node:fs/promises';
import {reconcileProductIds} from '../app/utils/syncDashboard.js';
if (!process.argv[2]) throw Error('Usage: node scripts/reconcile-product-ids.mjs <complete-snapshots.json>');
console.log(JSON.stringify(reconcileProductIds(JSON.parse(await fs.readFile(process.argv[2], 'utf8'))), null, 2));
