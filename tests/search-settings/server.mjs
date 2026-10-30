import fs from 'node:fs/promises';
import http from 'node:http';
import { build } from 'esbuild';
import { db, shop, admin, api, state } from './layer.mjs';
export async function createSettingsServer() {
  await db.searchSetting.deleteMany({ where: { shop } });
  await fs.writeFile('scratch/settings-admin-entry.jsx', `import React from 'react';import{createRoot}from'react-dom/client';import{createBrowserRouter,RouterProvider}from'react-router';import Component from '../app/routes/app.search.settings.jsx';const router=createBrowserRouter([{path:'*',loader:()=>fetch('/admin').then(r=>r.json()),action:async({request})=>fetch('/admin',{method:'POST',body:new URLSearchParams(await request.formData())}).then(r=>r.json()),Component}]);createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);`);
  await build({ entryPoints: ['scratch/settings-admin-entry.jsx'], bundle: true, outfile: 'scratch/settings-admin.js', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'server-stubs', setup(b) {
    b.onResolve({ filter: /(?:db|shopify|searchSettings|searchIndex)\.server(?:\.js)?$|@shopify\/shopify-app-react-router\/server/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const authenticate={};export const boundary={headers:()=>({})};export const getSearchIndexStatus=()=>({phase:"default"});export const getSearchSettings=()=>{};export const saveSearchSettings=()=>{};export const resetSearchSettings=()=>{};export default {};' }));
  } }] });
  const products = Array.from({ length: 45 }, (_, i) => ({ id: String(i + 1), title: 'Blue Dress ' + (i + 1), handle: 'dress-' + (i + 1), vendor: 'Fixture Vendor', priceMin: 10, priceMax: 10, compareAtPrice: 20, compareAtPriceMin: 20, tags: ['sale'], images: [], available: i !== 0, variants: [{id:String(i+1),price:10,compareAtPrice:20,available:i!==0}], options: [] }));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1'); let response;
      if (url.pathname === '/admin') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const request = new Request(url, { method: req.method, ...(req.method === 'POST' ? { body: Buffer.concat(chunks), headers: req.headers } : {}) });
        response = Response.json(await (req.method === 'POST' ? admin.action : admin.loader)({ request }));
      } else if (url.pathname === '/api/search-settings') {
        if (state.slow) await new Promise(r => setTimeout(r, 2200));
        response = await api.loader({ request: new Request(url) });
        if (state.legacyInstantEnabled === false && response.ok) {
          const body=await response.json();
          response=Response.json({...body,settings:{...body.settings,instantEnabled:false}});
        }
      } else if (url.pathname === '/api/search-redirect') response = Response.json({ redirectUrl: null });
      else if (url.pathname === '/api/search' || url.pathname === '/api/filter') {
        const limit = Number(url.searchParams.get('limit') || 6), page = Number(url.searchParams.get('page') || 1);
        response = Response.json({ products: products.slice((page - 1) * limit, page * limit), total: products.length, totalCount: products.length, facets: {}, globalSettings: {}, suggestions: ['Blue Dress', 'Blue Formal', 'Blue Party', 'Blue Satin', 'Blue Lace', 'Blue Tulle', 'Blue Velvet', 'Blue Mini', 'Blue Maxi', 'Blue Silk'].slice(0, Number(url.searchParams.get('suggestionLimit') ?? 6)) });
      } else if (url.pathname === '/collections.json' || url.pathname === '/search/suggest.json') {
        const collections = Array.from({ length: 10 }, (_, i) => ({ title: 'Dress Collection ' + (i + 1), handle: 'dress-' + (i + 1) }));
        response = Response.json({ collections, resources: { results: { collections } } });
      } else if (url.pathname === '/__control') {
        const chunks = []; for await (const c of req) chunks.push(c);
        Object.assign(state, JSON.parse(Buffer.concat(chunks))); response = Response.json(state);
      } else if (/^\/assets\/(searchSettings|instantSearch|collectionFilterPro)\.js$/.test(url.pathname)) {
        res.setHeader('Content-Type', 'application/javascript'); res.end((await fs.readFile('extensions/theme-extension' + url.pathname, 'utf8')).replaceAll('https://aisearchfilter.webvory.com', '')); return;
      } else if (url.pathname === '/assets/instantSearch.css') { res.setHeader('Content-Type', 'text/css'); res.end(await fs.readFile('extensions/theme-extension/assets/instantSearch.css')); return; }
      else if (url.pathname === '/settings-admin.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(await fs.readFile('scratch/settings-admin.js')); return; }
      else if (url.pathname === '/browser-checks.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(await fs.readFile('tests/search-settings/browser-checks.js')); return; }
      else if (url.pathname === '/test-runner') { res.end('<html><body><script src="/browser-checks.js"></script></body></html>'); return; }
      else {
        const template = url.pathname.startsWith('/collections') ? 'collection' : 'search';
        const grid = url.searchParams.has('grid');
        res.setHeader('Content-Type', 'text/html');
        res.end(url.pathname === '/admin-ui' ? '<html><body><div id="root"></div><script src="/settings-admin.js"></script></body></html>' : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/instantSearch.css"><script>window.Shopify={shop:${JSON.stringify(shop)},country:'US',currency:{active:'USD'},locale:'en',routes:{root:'/'}};window.cfpMarketPricing={apply:async(products,callback)=>products.forEach((p,i)=>callback({...p,_marketPricingUnavailable:false},i))};window.browserErrors=[];addEventListener('error',e=>{if(e.message)browserErrors.push(e.message)});addEventListener('unhandledrejection',e=>browserErrors.push(String(e.reason)));</script></head><body><header><form action="/search" class="cfp-inline-search-form"><input type="search" name="q" placeholder="Search"></form></header>${grid ? `<div class="cfp-layout-wrapper"><aside id="cfp-sidebar" data-shop="${shop}" data-template-name="${template}" data-search-terms="blue dress"><div id="cfp-dynamic-filters"></div></aside><main class="cfp-main-content"><div id="cfp-products-container"></div></main></div><script src="/assets/searchSettings.js" defer></script><script src="/assets/collectionFilterPro.js" defer></script>` : '<script src="/assets/searchSettings.js" defer></script><script src="/assets/searchSettings.js" defer></script><script src="/assets/instantSearch.js" defer></script>'}</body></html>`); return;
      }
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) { res.statusCode = 500; res.end(error.stack); }
  });
  return { server, async dispose() { server.close(); await db.searchSetting.deleteMany({ where: { shop } }); await db.$disconnect(); } };
}



