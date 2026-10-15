import fs from 'node:fs/promises';
import http from 'node:http';
import { build } from 'esbuild';
import { loadModule } from '../search/helpers/search-ranking.mjs';
import * as helpers from '../../app/utils/csvImportReport.js';
import * as conditionHelpers from '../../app/utils/merchandisingCondition.js';
let rows = [];
const state = { pinFailure: false, merchFailure: false }, writes = [];
const model = {
  findFirst: async ({ where }) => rows.find(r => Object.entries(where).every(([k, v]) => r[k] === v)) || null,
  create: async ({ data }) => { const value = { id: String(rows.length + 1), ...data }; rows.push(value); return value; },
  update: async ({ where, data }) => Object.assign(rows.find(r => r.id === where.id), data),
};
const prisma = { merchandisingRule: model, $transaction: async fn => { const previous = structuredClone(rows); try { return await fn({ merchandisingRule: model }); } catch (e) { rows = previous; throw e; } } };
const merch = await loadModule('app/services/merchandisingImport.server.js', { '../db.server': { default: prisma }, '../utils/merchandisingCondition.js': conditionHelpers, '../utils/csvImportReport.js': helpers });
const pin = await loadModule('app/routes/api.import-pins-batch.jsx', {
  '../shopify.server': { authenticate: { admin: async () => ({ session: { shop: 'fixture.myshopify.com' } }) } },
  '../utils/csvImportReport.js': helpers, '../services/shopCache.server.js': { invalidateShop: async () => {} },
  '../db.server': { default: { product: { findMany: async () => [{ id: 'gid://shopify/Product/1', title: 'Dress', images: [] }] }, collection: { findMany: async () => [{ id: 'gid://shopify/Collection/1', title: 'Summer' }] }, pinnedProductRule: { upsert: async data => writes.push(data) } } },
});
await fs.writeFile('scratch/csv-import-entry.jsx', `import React,{useState}from'react';import{createRoot}from'react-dom/client';import Merch from '../app/components/merchandising/ImportMerchandisingRulesModal.jsx';import Collection from '../app/components/merchandising/ImportCollectionPinsModal.jsx';import Search from '../app/components/merchandising/ImportSearchPinsModal.jsx';window.toasts=[];window.shopify={toast:{show:message=>window.toasts.push(message)}};function Harness(){const[open,setOpen]=useState(true),[busy,setBusy]=useState(false),[result,setResult]=useState(null);const p=new URLSearchParams(location.search),kind=p.get('kind')||'merch',scope=p.get('scope')||'collection';return <><button onClick={()=>setOpen(true)}>Open importer</button>{kind==='merch'?<Merch isOpen={open} ruleType={scope} onClose={()=>setOpen(false)} isSubmitting={busy} importResult={result} onSubmit={async rules=>{setBusy(true);try{const r=await fetch('/api/import-merch',{method:'POST',body:JSON.stringify({rules,scope})});setResult(await r.json())}catch{setResult({error:'The import could not be confirmed. Check existing rules before retrying.'})}finally{setBusy(false)}}}/>:scope==='search'?<Search isOpen={open} onClose={()=>setOpen(false)}/>:<Collection isOpen={open} onClose={()=>setOpen(false)}/>}</>};createRoot(document.getElementById('root')).render(<Harness/>);`);
await build({ entryPoints: ['scratch/csv-import-entry.jsx'], outfile: 'scratch/csv-import-browser.js', bundle: true, jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' } });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture');
  try {
    if (url.pathname === '/browser.js' || url.pathname === '/checks.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile(url.pathname === '/browser.js' ? 'scratch/csv-import-browser.js' : 'tests/csv-import/browser-checks.js')); return; }
    if (url.pathname === '/test-runner') { res.end('<html><body><script src="/checks.js"></script></body></html>'); return; }
    if (req.method === 'POST') {
      const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks).toString();
      if (url.pathname === '/__control') { Object.assign(state, JSON.parse(body)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state)); return; }
      if (url.pathname === '/api/import-merch') {
        const { rules, scope } = JSON.parse(body); const report = state.merchFailure ? { error: 'Import could not be confirmed. Check existing rules before retrying.' } : await merch.importMerchandisingRules('fixture.myshopify.com', rules, scope);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...report, success: !report.error, count: report.imported })); return;
      }
      if (url.pathname === '/api/import-pins-batch') {
        const value = JSON.parse(body);
        if (state.pinFailure && value.rows.some(r => r.externalId === 'failure-0')) { res.writeHead(503).end('offline'); return; }
        const response = await pin.action({ request: new Request('https://fixture/api/import-pins-batch', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }) });
        res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(await response.text()); return;
      }
    }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px Arial;margin:0}button{cursor:pointer}</style></head><body><div id="root"></div><script>window.browserErrors=[];addEventListener("error",e=>browserErrors.push(e.message));addEventListener("unhandledrejection",e=>browserErrors.push(String(e.reason)));</script><script src="/browser.js"></script></body></html>');
  } catch { res.writeHead(500).end('Fixture request failed'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await fs.writeFile('scratch/csv-import-fixture.json', JSON.stringify({ origin: 'http://127.0.0.1:' + server.address().port, pid: process.pid }));
console.log('http://127.0.0.1:' + server.address().port);
const timer = setInterval(async () => { if (await fs.access('scratch/csv-import-fixture-stop-' + process.pid).then(() => true, () => false)) { clearInterval(timer); server.close(); } }, 500);
