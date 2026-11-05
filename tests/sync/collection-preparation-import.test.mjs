import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('collection warmup service imports in the production Node runtime', () => {
  const child=spawnSync(process.execPath,['--input-type=module','-e',
    "await import('./app/services/collectionPreparation.server.js'); console.log('COLLECTION_PREPARATION_IMPORT_OK'); process.exit(0);"],{
    cwd:process.cwd(),encoding:'utf8',timeout:15000,
    env:{...process.env,DATABASE_URL:'postgresql://test:test@127.0.0.1:5432/test',
      SHOPIFY_APP_URL:'https://example.test',SHOPIFY_API_KEY:'test',SHOPIFY_API_SECRET:'test'},
  });
  assert.equal(child.status,0,child.stderr||child.error?.message);
  assert.match(child.stdout,/COLLECTION_PREPARATION_IMPORT_OK/);
});
