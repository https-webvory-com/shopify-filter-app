import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
const source = await fs.readFile('scripts/flush-cache.js', 'utf8');
async function fixture({ keys = [], fail, quitFailure = false } = {}) {
  const calls = []; let options;
  class Redis {
    constructor(url, config) { assert.equal(url, 'redis://fixture'); options = config; this.status = 'wait'; }
    on() {}
    async connect() { calls.push('connect'); if (fail === 'connect') throw Error('unavailable'); this.status = 'ready'; }
    async keys(pattern) { calls.push(['keys', pattern]); if (fail === 'keys') throw Error('unavailable'); return keys.filter(key => key.includes(pattern.replaceAll('*', ''))); }
    async del(...keys) { calls.push(['del', ...keys]); if (fail === 'del') throw Error('unavailable'); }
    async quit() { calls.push('quit'); if (quitFailure) throw Error('unavailable'); }
    disconnect() { calls.push('disconnect'); }
  }
  const body = source.replace(/^import .*;\r?\n/gm, '');
  await vm.runInNewContext('(async()=>{' + body + '})()', { Redis, REDIS_URL: 'redis://fixture', console: { log() {}, error() {} } });
  return { calls, options };
}
test('maintenance flush has no app/worker imports and never forces process exit', () => {
  const imports = [...source.matchAll(/^import .* from ['"](.+)['"];?$/gm)].map(match => match[1]);
  assert.deepEqual(imports, ['ioredis', '../app/services/redisConnection.server.js']);
  assert.ok(!source.includes('process.exit('));
});
test('startup flush only deletes existing response/rule caches and closes naturally', async () => {
  const f = await fixture({ keys: ['shop:fullApiResponse:q', 'shop:merch:q', 'shop:pinning:q', 'session:keep', 'queue:keep', 'prepared:keep'] });
  assert.deepEqual(f.calls.find(c => Array.isArray(c) && c[0] === 'del'), ['del', 'shop:fullApiResponse:q', 'shop:merch:q', 'shop:pinning:q']);
  assert.deepEqual(f.calls.slice(-2), ['quit', 'disconnect']);
  assert.equal(f.options.connectTimeout, 10000); assert.equal(f.options.commandTimeout, 10000);
  assert.equal(f.options.retryStrategy(), null); assert.equal(f.options.maxRetriesPerRequest, 1);
});
test('empty caches need no delete and all Redis failures finish cleanup', async () => {
  const empty = await fixture(); assert.ok(!empty.calls.some(c => Array.isArray(c) && c[0] === 'del'));
  for (const fail of ['connect', 'keys', 'del']) {
    const f = await fixture({ keys: ['fullApiResponse'], fail });
    assert.equal(f.calls.at(-1), 'disconnect');
  }
  assert.equal((await fixture({ quitFailure: true })).calls.at(-1), 'disconnect');
});
test('Docker performs schema setup then uses the single best-effort startup flush', async () => {
  const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  assert.ok(pkg.scripts['docker-start'].endsWith('&& npm run setup && npm run start'));
  assert.ok(!pkg.scripts['docker-start'].includes('flush-cache'));
  assert.ok(pkg.scripts.start.startsWith('node scripts/flush-cache.js || true; node scripts/serve-with-health-watchdog.mjs'));
});

test('real ioredis maintenance process exits cleanly against an isolated loopback Redis fixture', { timeout: 15000 }, async () => {
  const commands = [], sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer) {
        const end = buffer.indexOf('\r\n'); if (end < 0) return;
        const count = Number(buffer.slice(1, end)); let cursor = end + 2; const args = [];
        for (let i = 0; i < count; i++) {
          const lengthEnd = buffer.indexOf('\r\n', cursor); if (lengthEnd < 0) return;
          const length = Number(buffer.slice(cursor + 1, lengthEnd)); cursor = lengthEnd + 2;
          if (buffer.length < cursor + length + 2) return;
          args.push(buffer.slice(cursor, cursor + length)); cursor += length + 2;
        }
        buffer = buffer.slice(cursor); commands.push(args);
        switch (args[0].toLowerCase()) {
          case 'info': { const info = 'redis_version:7.0.0\r\nloading:0\r\n'; socket.write('$' + Buffer.byteLength(info) + '\r\n' + info + '\r\n'); break; }
          case 'keys': socket.write('*0\r\n'); break;
          case 'quit': socket.end('+OK\r\n'); break;
          default: socket.write('+OK\r\n');
        }
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let child;
  try {
    await fs.mkdir('scratch', { recursive: true });
    const directory = await fs.mkdtemp(path.resolve('scratch', 'startup-cache-smoke-'));
    await fs.mkdir(path.join(directory, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(directory, 'app/services'), { recursive: true });
    await fs.writeFile(path.join(directory, 'scripts/flush-cache.js'), source);
    await fs.writeFile(path.join(directory, 'app/services/redisConnection.server.js'), `export const REDIS_URL='redis://127.0.0.1:${server.address().port}';`);
    child = spawn(process.execPath, [path.join(directory, 'scripts/flush-cache.js')], { windowsHide: true });
    let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    const timeout = setTimeout(() => child.kill(), 10000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); clearTimeout(timeout);
    assert.equal(code, 0, output); assert.ok(output.includes('No stale cache entries'));
    assert.ok(!output.includes('shopify-api')); assert.equal(commands.filter(c => c[0].toLowerCase() === 'keys').length, 3);
    assert.ok(commands.some(c => c[0].toLowerCase() === 'quit'));
  } finally { child?.kill(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
});
