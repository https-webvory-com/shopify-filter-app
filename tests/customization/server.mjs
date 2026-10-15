import fs from 'node:fs/promises';
import http from 'node:http';
import { build } from 'esbuild';
import { db, shop, admin, api, state } from './layer.mjs';

export async function createCustomizationServer() {
  await db.themeCustomization.deleteMany({ where: { shop } });
  await fs.writeFile('scratch/customization-admin-entry.jsx', `import React from 'react';import{createRoot}from'react-dom/client';import{createBrowserRouter,RouterProvider}from'react-router';import Screen from '../app/routes/app.settings.customization.jsx';const router=createBrowserRouter([{path:'*',Component:Screen,loader:({request})=>fetch('/admin'+new URL(request.url).search).then(r=>r.json()),action:async({request})=>fetch('/admin',{method:'POST',body:new URLSearchParams(await request.formData())}).then(r=>r.json())}]);createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);`);
  await build({ entryPoints: ['scratch/customization-admin-entry.jsx'], outfile: 'scratch/customization-admin.js', bundle: true, jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'customization-fixture-server-stubs', setup(b) {
    b.onResolve({ filter: /(?:db|shopify|customization)\.server(?:\.js)?$|graphql\/queries$|@shopify\/shopify-app-react-router\/server/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const authenticate={};export const boundary={headers:()=>({})};export const GET_THEME="";export const getCustomization=()=>{};export const saveCustomization=()=>{};export const resetCustomization=()=>{};export default {};' }));
  } }] });
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'), origin = 'http://' + req.headers.host;
      let response;
      if (url.pathname === '/admin') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const request = new Request(url, { method: req.method, ...(req.method === 'POST' ? { body: Buffer.concat(chunks), headers: req.headers } : {}) });
        response = Response.json(await (req.method === 'POST' ? admin.action : admin.loader)({ request }));
      } else if (url.pathname === '/api/customization') {
        if (state.slow) await new Promise(r => setTimeout(r, 2200));
        response = await api.loader({ request: new Request(url) });
      } else if (url.pathname === '/__control') {
        const chunks = []; for await (const c of req) chunks.push(c); Object.assign(state, JSON.parse(Buffer.concat(chunks))); response = Response.json(state);
      } else if (url.pathname === '/assets/customization.js') {
        res.setHeader('Content-Type', 'text/javascript'); res.end((await fs.readFile('extensions/theme-extension/assets/customization.js', 'utf8')).replace('https://aisearchfilter.webvory.com/api/customization', origin + '/api/customization')); return;
      } else if (url.pathname === '/customization-admin.js') {
        res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile('scratch/customization-admin.js')); return;
      } else if (url.pathname === '/browser-checks.js') {
        res.setHeader('Content-Type', 'text/javascript'); res.end(await fs.readFile('tests/customization/browser-checks.js')); return;
      } else if (url.pathname === '/test-runner') { res.end('<html><body><script src="/browser-checks.js"></script></body></html>'); return; }
      else if (url.pathname === '/store') {
        res.setHeader('Content-Type', 'text/html');
        const themeId = url.searchParams.get('themeId') === '2' ? '2' : '1';
        res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script>window.cfpCustomizationContext={shop:${JSON.stringify(shop)},themeId:${JSON.stringify(themeId)}};window.coreStarted=performance.now();window.browserErrors=[];window.productOrder=['1','2'];addEventListener('error',e=>browserErrors.push(e.message));window.addSwatch=()=>{document.querySelector('#cfp-sidebar').insertAdjacentHTML('beforeend','<label class="cfp-color-swatch"><input value=" NAVY   blue "><span class="cfp-swatch-circle" style="background:red">new</span></label>')};</script><script defer src="/assets/customization.js"></script><script defer src="/assets/customization.js"></script></head><body><div id="cfp-sidebar"><h2 class="cfp-filter-title">Filters</h2><label class="cfp-color-swatch"><input value="Navy Blue"><span class="cfp-swatch-circle" style="background:red">swatch</span></label></div><div class="cfp-product-card" data-id="1">Dress 1</div><div class="cfp-product-card" data-id="2">Dress 2</div><div class="cfp-search-modal">Instant search</div></body></html>`); return;
      } else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px Arial;margin:16px}s-page{display:block}button{cursor:pointer}</style></head><body><div id="root"></div><script src="/customization-admin.js"></script></body></html>'); return; }
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch { res.writeHead(500).end('Fixture unavailable'); }
  });
  return { server, async dispose() { server.close(); await db.themeCustomization.deleteMany({ where: { shop } }); await db.$disconnect(); } };
}
