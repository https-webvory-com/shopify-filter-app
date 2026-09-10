import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { createFixtureServer } from './server.mjs';

const cli = process.env.AGENT_BROWSER_BIN || 'agent-browser';
const session = `qv-regression-${process.pid}`;
const execute = promisify(execFile);
const command = async (...args) => {
  const { stdout } = await execute(cli, ['--session', session, ...args], { maxBuffer: 1024 * 1024, timeout: 45000, windowsHide: true });
  return stdout;
};
const server = createFixtureServer();
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4179, '127.0.0.1', resolve);
  });
  console.log('Quick View fixture server ready');
  const launch = process.env.AGENT_BROWSER_EXECUTABLE_PATH ? ['--executable-path', process.env.AGENT_BROWSER_EXECUTABLE_PATH] : [];
  await command(...launch, 'open', 'http://127.0.0.1:4179/tests/quick-view/index.html');
  const results = JSON.parse(await command('eval', 'window.runQuickViewTests()'));
  for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}`);
  assert.equal(results.filter(result => !result.passed).length, 0, 'Quick View regressions failed');
  for (const [width, height] of [[320, 568], [375, 667], [430, 932], [1440, 900]]) {
    await command('set', 'viewport', String(width), String(height));
    const layout = JSON.parse(await command('eval', 'window.runQuickViewLayoutTest()'));
    assert.ok(layout.fits && layout.closeVisible && layout.cartVisible && !layout.overflow, JSON.stringify(layout));
    console.log(`PASS layout ${width}x${height}`);
  }
  await command('open', 'http://127.0.0.1:4179/tests/quick-view/native.html');
  const nativeResults = JSON.parse(await command('eval', 'window.runNativeQuickViewTests()'));
  for (const result of nativeResults) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}`);
  assert.equal(nativeResults.filter(result => !result.passed).length, 0, 'Native Quick View regressions failed');
} finally {
  await command('close').catch(() => {});
  server.close();
}
