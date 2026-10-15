import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createCustomizationServer } from './server.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = await createCustomizationServer();
await new Promise(resolve => fixture.server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + fixture.server.address().port;
const profile = path.resolve('scratch', 'customization-headless-' + process.pid);
await fs.mkdir(profile, { recursive: true });
const chrome = spawn(process.env.HEADLESS_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '', socket;
chrome.stderr.on('data', chunk => stderr += chunk.toString());
try {
  let endpoint;
  for (let i = 0; i < 100; i++) { endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]; if (endpoint) break; if (chrome.exitCode !== null) throw Error('Chrome exited before connecting'); await delay(100); }
  if (!endpoint) throw Error('Chrome startup timeout');
  const targets = await (await fetch('http://127.0.0.1:' + new URL(endpoint).port + '/json')).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await Promise.race([new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); }), delay(10000).then(() => { throw Error('Chrome connection timeout'); })]);
  let next = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (!message.id) return; const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p?.timer); message.error ? p?.reject(Error(message.error.message)) : p?.resolve(message.result); });
  const send = (method, params = {}, timeout = 15000) => new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(Error('Browser command timed out: ' + method)); }, timeout); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression, timeout) => { const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout); if (response.exceptionDetails) throw Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text); return response.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Page.navigate', { url: origin + '/test-runner' });
  let ready = false; for (let i = 0; i < 100; i++) { if (await evaluate("typeof window.runCustomizationChecks === 'function'")) { ready = true; break; } await delay(100); }
  assert.ok(ready, 'Browser checks did not load');
  const results = await evaluate('window.runCustomizationChecks()', 90000);
  await fs.writeFile('scratch/customization-headless-results.json', JSON.stringify({ environment: 'Actual editor, service, public API and storefront asset; isolated PostgreSQL; mock Shopify authentication and synthetic storefront', results }, null, 2));
  for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.name}${r.error ? ': ' + r.error : ''}`);
  assert.equal(results.filter(r => !r.passed).length, 0, 'Customization browser checks failed');
  console.log('HEADLESS CUSTOMIZATION CHECKS PASSED: ' + results.length);
} finally { socket?.close(); chrome.kill(); await fixture.dispose(); }
