import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = spawn(process.execPath, ['tests/search-pinning/serve-fixture.mjs'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', errors = '', chrome, socket;
fixture.stdout.on('data', data => output += data); fixture.stderr.on('data', data => errors += data);
const report = { environment: 'Local actual React editors/actions with mock Shopify authentication and in-memory fixture catalog; no live writes', checks: [] };
try {
  for (let i = 0; i < 200 && !output.match(/http:\/\/127\.0\.0\.1:\d+/); i++) { if (fixture.exitCode !== null) throw Error(errors || 'Fixture exited'); await pause(100); }
  const origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (!origin) throw Error('Fixture startup timeout: ' + errors);
  const profile = path.resolve('scratch', 'single-term-pinning-' + process.pid); await fs.mkdir(profile, { recursive: true });
  chrome = spawn(process.env.HEADLESS_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; chrome.stderr.on('data', data => stderr += data);
  for (let i = 0; i < 100 && !stderr.includes('DevTools listening on'); i++) await pause(100);
  const endpoint = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1]; if (!endpoint) throw Error('Chrome startup failed');
  const pages = await (await fetch('http://127.0.0.1:' + new URL(endpoint).port + '/json')).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); const task = pending.get(message.id); if (!task) return; clearTimeout(task.timer); pending.delete(message.id); message.error ? task.reject(Error(message.error.message)) : task.resolve(message.result); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error('Timeout: ' + method)); }, 30000); pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text); return value.result.value; };
  const wait = async expression => { for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await pause(100); } throw Error('UI timeout: ' + expression + '\n' + await evaluate('document.body.innerText.slice(0,1500)')); };
  const navigate = async route => { await send('Page.navigate', { url: origin + route }); await wait('!!document.querySelector("#root s-page")'); };
  const fill = async (selector, value) => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const click = text => evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Missing button');e.click();})()`);
  const state = async () => (await fetch(origin + '/state')).json();
  const control = async data => fetch(origin + '/__control', { method: 'POST', body: JSON.stringify(data) });
  const check = (name, pass = true) => { assert.ok(pass, name); report.checks.push({ name, pass: true }); console.log('PASS ' + name); };
  await send('Page.enable'); await send('Runtime.enable');
  await navigate('/admin-ui');
  await evaluate(await fs.readFile('tests/search-pinning/browser-checks.js', 'utf8'));
  const existing = await evaluate('window.runPinningChecks()');
  for (const result of existing.checks) check(result.name, result.pass);

  const original = { id: 'gid://shopify/Product/1', title: 'Green Dress 1', handle: 'dress-1', image: null };
  await control({ searchQueries: ['green dresses'], products: [original], applyToAll: false, applyToSearchType: 'both' });
  await navigate('/admin-ui'); await wait("document.querySelectorAll('.product-search-card').length===9");
  check('editor has one editable search term and no Add control', await evaluate("document.querySelectorAll('#search-pin-term').length===1&&![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Add')"));
  await fill('#search-pin-term', 'red dresses'); await wait("document.querySelectorAll('.product-search-card').length===3&&[...document.querySelectorAll('.product-search-card')].every(c=>c.textContent.includes('Red'))");
  check('replacement term refreshes the matching picker', true);
  check('typing a replacement does not alter saved terms', (await state()).searchQueries[0] === 'green dresses');
  await click('Save');
  for (let i = 0; i < 100 && (await state()).searchQueries[0] !== 'red dresses'; i++) await pause(50);
  const replaced = await state(); assert.deepEqual(replaced.searchQueries, ['red dresses']); assert.deepEqual(replaced.products, [original]);
  check('Save replaces the previous term and preserves existing pinned products');
  await navigate('/admin-ui'); await wait("document.querySelector('#search-pin-term')?.value==='red dresses'");
  check('reloading shows only the replacement term');
  await fill('#search-pin-term', 'green dresses'); await fill('#search-pin-term', 'red dresses');
  await wait("document.querySelectorAll('.product-search-card').length===3&&[...document.querySelectorAll('.product-search-card')].every(c=>c.textContent.includes('Red'))");
  check('rapid term changes leave only the latest matching products');
  await fill('#search-pin-term', '   '); await pause(650); await click('Save'); await pause(200);
  check('blank terms cannot be saved or show the unrestricted catalog', (await state()).searchQueries[0] === 'red dresses' && await evaluate("document.querySelectorAll('.product-search-card').length===0"));

  await control({ searchQueries: ['green dresses', 'red dresses'] }); await navigate('/admin-ui');
  await wait("!!document.querySelector('[role=note]')");
  check('legacy multi-term rules require an explicit selection', await evaluate("document.querySelector('#search-pin-term').value===''&&document.querySelector('[role=note]').textContent.includes('green dresses, red dresses')"));
  await click('Save'); await pause(200); assert.deepEqual((await state()).searchQueries, ['green dresses', 'red dresses']);
  check('opening or attempting to save a legacy rule does not silently discard its terms');
  await fill('#search-pin-term', 'green dresses'); await click('Save');
  for (let i = 0; i < 100 && (await state()).searchQueries.length !== 1; i++) await pause(50);
  assert.deepEqual((await state()).searchQueries, ['green dresses']); check('explicitly choosing a term updates the legacy rule');

  await navigate('/list-ui');
  await evaluate("document.querySelector('.create-pin-dropdown-inside>div').click()");
  await wait("[...document.querySelectorAll('div')].some(e=>e.textContent.trim()==='Create a New Pin')");
  await evaluate("[...document.querySelectorAll('div')].find(e=>e.textContent.trim()==='Create a New Pin').click()");
  await wait("!!document.querySelector('#create-pin-term')");
  check('creation uses one term and disables Continue for empty input', await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Continue').disabled&&![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Add')"));
  await fill('#create-pin-term', 'red party dresses'); await click('Continue');
  await wait("document.querySelector('#search-pin-term')?.value==='red party dresses'");
  check('Continue opens a new rule with exactly the entered term', await evaluate("JSON.parse(new URL(location.href).searchParams.get('searchQueries')).length===1"));
  await wait("document.querySelectorAll('.product-search-card').length===3");
  await evaluate("document.querySelector('.product-search-card button').click()"); await click('Save');
  for (let i = 0; i < 100 && (await state()).searchQueries[0] !== 'red party dresses'; i++) await pause(50);
  assert.deepEqual((await state()).searchQueries, ['red party dresses']); check('new-rule Save persists a single search term');
  assert.deepEqual(await evaluate('window.browserErrors'), []); check('new-rule editor has no browser errors');
  await evaluate(await fs.readFile('tests/search-pinning/list-sort-checks.js', 'utf8'));
  const sorting = await evaluate('window.runPinningListSortChecks()');
  for (const result of sorting.checks) check(result.name, result.pass);
  console.log('PINNING BROWSER CHECKS PASSED: ' + report.checks.length);
} catch (error) { report.error = error.stack; console.error(error.stack); process.exitCode = 1; }
finally {
  await fs.writeFile('scratch/single-term-pinning-browser-results.json', JSON.stringify(report, null, 2));
  socket?.close(); chrome?.kill();
  await fs.writeFile('scratch/pinning-fixture-stop-' + fixture.pid, 'stop');
  await Promise.race([new Promise(resolve => fixture.once('exit', resolve)), pause(2000)]);
  if (fixture.exitCode === null) fixture.kill();
}
