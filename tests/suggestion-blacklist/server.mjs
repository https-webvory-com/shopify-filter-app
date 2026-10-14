import fs from 'node:fs/promises';
import http from 'node:http';
import {build} from 'esbuild';
import {db,admin,api,shop,state} from './layer.mjs';

export async function createBlacklistServer() {
  await db.searchSuggestionBlacklist.deleteMany({where:{shop}});
  await fs.writeFile('scratch/blacklist-admin-entry.jsx', `import React from 'react';import {createRoot} from 'react-dom/client';import {createBrowserRouter,RouterProvider} from 'react-router';import Screen from '../app/routes/app.search.blacklist.jsx';const router=createBrowserRouter([{path:'*',Component:Screen,loader:async()=>await(await fetch('/admin')).json(),action:async({request})=>await(await fetch('/admin',{method:'POST',body:await request.formData()})).json()}]);createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);`);
  await build({entryPoints:['scratch/blacklist-admin-entry.jsx'],bundle:true,outfile:'scratch/blacklist-admin.js',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{
    name:'server-stubs',setup(builder){
      builder.onResolve({filter:/(?:db|shopify|suggestionBlacklist)\.server(?:\.js)?$|@shopify\/shopify-app-react-router\/server/},args=>({path:args.path,namespace:'stub'}));
      builder.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const authenticate={};export const boundary={headers:()=>({})};export const saveSuggestionBlacklist=()=>{};export default {};'}));
    },
  }]});
  const storefront=`<!doctype html><html><head><link rel="stylesheet" href="/assets/instantSearch.css"><script>window.Shopify={shop:${JSON.stringify(shop)},locale:'en',currency:{active:'USD',rate:1},routes:{root:'/'}};window.CFP_InstantSearchSettings={customTriggerSelector:'#open-search'};window.browserErrors=[];addEventListener('error',e=>browserErrors.push(e.message));addEventListener('unhandledrejection',e=>browserErrors.push(String(e.reason)));</script></head><body><button id="open-search">Search</button><script src="/assets/instantSearch.js" defer></script></body></html>`;
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://127.0.0.1');let response;
      if(url.pathname==='/admin') {
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const request=new Request(url,{method:req.method,...(req.method==='POST'?{body:Buffer.concat(chunks),headers:req.headers}:{})});
        response=Response.json(req.method==='POST'?await admin.action({request}):await admin.loader({request}));
      } else if(url.pathname==='/api/search') {
        state.searchRequests++;
        response=await api.loader({request:new Request(url)});
      } else if(url.pathname==='/search/suggest.json') {
        response=Response.json({resources:{results:{collections:[]}}});
      } else if(url.pathname==='/api/search-redirect') {
        response=Response.json({redirectUrl:null});
      } else if(url.pathname.startsWith('/assets/')) {
        const name=url.pathname.slice(8);
        if(!['instantSearch.js','instantSearch.css'].includes(name)){res.statusCode=404;res.end();return;}
        res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'application/javascript');
        const source=await fs.readFile('extensions/theme-extension/assets/'+name,'utf8');
        res.end(name.endsWith('.js')?source.replace("var API_DOMAIN = 'https://aisearchfilter.webvory.com';",'var API_DOMAIN = location.origin;'):source);return;
      } else if(url.pathname==='/blacklist-admin.js') {
        res.setHeader('Content-Type','application/javascript');res.end(await fs.readFile('scratch/blacklist-admin.js'));return;
      } else {
        res.setHeader('Content-Type','text/html');
        res.end(url.pathname==='/admin-ui'?'<html><body><div id="root"></div><script src="/blacklist-admin.js"></script></body></html>':storefront);return;
      }
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
    } catch(error) {res.statusCode=500;res.end('Fixture request failed: '+error.message);}
  });
  return {server,state,async dispose(){server.close();await db.searchSuggestionBlacklist.deleteMany({where:{shop}});await db.$disconnect();}};
}
