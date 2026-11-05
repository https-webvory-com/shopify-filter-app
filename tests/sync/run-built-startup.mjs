import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Run after the production build. No real Redis, Shopify or database operations.
if (!process.argv.includes('--child')) {
  for (const role of ['web', 'worker']) {
    const child = spawn(process.execPath, [
      '--experimental-loader', new URL('./startup-infrastructure-loader.mjs', import.meta.url).href,
      fileURLToPath(import.meta.url), '--child', role,
    ], {env: {...process.env, NODE_ENV:'production', CFP_WORKER_MODE:role,
      SHOPIFY_API_KEY:'startup-fixture', SHOPIFY_API_SECRET:'startup-fixture',
      SHOPIFY_APP_URL:'https://startup.invalid', DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:1/fixture'},
      stdio:'inherit', windowsHide:true, timeout:30000});
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', resolve);
    });
    assert.equal(code, 0, `${role} production bundle startup failed`);
  }
} else {
  // Import the exact entry used by both deployment commands, not transformed
  // individual modules or mocks of the application's internal services.
  const build = await import('../../build/server/index.js');
  globalThis.__startupRedis.emit('connect');
  await new Promise(resolve => setImmediate(resolve));
  const names = ['__productSyncWorker','__webhookWorker','__collectionRankingWorker','__searchIndexWorker',
    '__collectionOrderWorker','__collectionMembershipWorker','__marketAvailabilityWorker'];
  if (process.env.CFP_WORKER_MODE === 'worker') {
    await Promise.all(names.map(name => {
      assert.ok(globalThis[name], `${name} was not initialized`);
      return globalThis[name].waitUntilReady();
    }));
  } else {
    for (const name of names) assert.equal(globalThis[name], undefined);
    const {createRequestHandler} = await import('react-router');
    const {createServer} = await import('node:http');
    const handler = createRequestHandler(build, 'production');
    const server = createServer(async (req, res) => {
      try {
        const response = await handler(new Request(`http://localhost${req.url}`));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text());
      } catch (error) { res.writeHead(500); res.end(error.message); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
      assert.equal(response.status, 200);
    } finally { await new Promise(resolve => server.close(resolve)); }
  }
  console.log(`PASS: built ${process.env.CFP_WORKER_MODE} startup`);
  process.exit(0);
}
