import fs from 'node:fs/promises';
import http from 'node:http';
import {build} from 'esbuild';
import {db,shop,admin,api,state} from './layer.mjs';
export async function createBannerServer() {
  await db.searchBanner.deleteMany({where:{shop}});
  await fs.writeFile('scratch/banner-admin-entry.jsx',`import React from 'react';import{createRoot}from'react-dom/client';import{createBrowserRouter,RouterProvider}from'react-router';import Component from '../app/routes/app.search.banners.jsx';const router=createBrowserRouter([{path:'*',loader:()=>fetch('/admin').then(r=>r.json()),action:async({request})=>fetch('/admin',{method:'POST',body:new URLSearchParams(await request.formData())}).then(r=>r.json()),Component}]);createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);`);
  await build({entryPoints:['scratch/banner-admin-entry.jsx'],bundle:true,outfile:'scratch/banner-admin.js',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'server-stubs',setup(b){b.onResolve({filter:/(?:db|shopify|searchBanner)\.server(?:\.js)?$|@shopify\/shopify-app-react-router\/server/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const authenticate={};export const boundary={headers:()=>({})};export const saveSearchBanner=()=>{};export default {};'}));}}]});
  const cards = n => Array.from({length:n},(_,i)=>`<li class="cfp-product-card grid__item" data-product="${i+1}"><a href="/products/fixture-${i+1}">Product ${i+1}</a></li>`).join('');
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://127.0.0.1');let response;
      if(url.pathname==='/admin') {
        const chunks=[];for await(const c of req)chunks.push(c);
        const request=new Request(url,{method:req.method,...(req.method==='POST'?{body:Buffer.concat(chunks),headers:req.headers}:{})});response=Response.json(req.method==='POST'?await admin.action({request}):await admin.loader({request}));
      } else if(url.pathname==='/api/search-banners') {
        if(state.slow)await new Promise(resolve=>setTimeout(resolve,2500));
        response=state.corrupt ? Response.json({banners:[{id:'corrupt',placement:'grid',position:1,heading:'Safe text',imageUrl:'javascript:alert(1)',targetUrl:'javascript:alert(1)',textColor:'red;display:none'}]}) : await api.loader({request:new Request(url)});
      }
      else if(url.pathname==='/__control') {const chunks=[];for await(const c of req)chunks.push(c);Object.assign(state,JSON.parse(Buffer.concat(chunks)));response=Response.json(state);}
      else if(url.pathname==='/assets/searchBanners.js') {res.setHeader('Content-Type','application/javascript');res.end((await fs.readFile('extensions/theme-extension/assets/searchBanners.js','utf8')).replace('https://aisearchfilter.webvory.com/api/search-banners', '/api/search-banners'));return;}
      else if(url.pathname==='/assets/searchBanners.css') {res.setHeader('Content-Type','text/css');res.end(await fs.readFile('extensions/theme-extension/assets/searchBanners.css'));return;}
      else if(url.pathname==='/banner-admin.js') {res.setHeader('Content-Type','application/javascript');res.end(await fs.readFile('scratch/banner-admin.js'));return;}
      else if(url.pathname==='/browser-checks.js') {res.setHeader('Content-Type','application/javascript');res.end(await fs.readFile('tests/search-banners/browser-checks.js'));return;}
      else if(url.pathname==='/test-runner') {res.setHeader('Content-Type','text/html');res.end('<html><body><script src="/browser-checks.js"></script></body></html>');return;}
      else {
        res.setHeader('Content-Type','text/html');
        const native=url.searchParams.get('native')==='true', count=url.searchParams.get('empty')?0:4;
        if(state.probeFail&&url.searchParams.get('page')==='1'){res.statusCode=500;res.end('Fixture native probe failure');return;}
        res.end(url.pathname==='/admin-ui'?'<html><body><div id="root"></div><script src="/banner-admin.js"></script></body></html>':`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/searchBanners.css"><style>body{margin:0;font-family:Arial}main{padding:16px}ul{padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.cfp-product-card{list-style:none;min-height:200px;border:1px solid #aaa}</style><script>window.Shopify={shop:${JSON.stringify(shop)}};window.browserErrors=[];addEventListener('error',e=>{if(e.message)browserErrors.push(e.message)});addEventListener('unhandledrejection',e=>browserErrors.push(String(e.reason)));</script></head><body><main><div class="template-search"><h1>Search results</h1><span id="product-count">${count} products</span><ul id="${native?'product-grid':'cfp-products-container'}" ${native?'':'data-cfp-search-offset="'+(url.searchParams.get('offset')||0)+'"'}>${cards(count)}</ul></div></main><script src="/assets/searchBanners.js" defer></script></body></html>`);return;
      }
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
    } catch(error) {res.statusCode=500;res.end('Fixture request failed: '+error.message);}
  });
  return {server,async dispose(){server.close();await db.searchBanner.deleteMany({where:{shop}});await db.$disconnect();}};
}
