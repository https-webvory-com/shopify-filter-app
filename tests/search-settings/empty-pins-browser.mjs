import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
import {DEFAULT_SEARCH_SETTINGS,validateSearchSettings} from '../../app/utils/searchSettings.js';

const products=[1,2,3].map(id=>({id:'gid://shopify/Product/'+id,title:['Alpha Snowboard','Beta Snowboard','Gamma Snowboard'][id-1],image:''}));
let settings=structuredClone(DEFAULT_SEARCH_SETTINGS),saves=0,pickerReads=0;
const entry='scratch/empty-pins-admin-entry.jsx',bundle='scratch/empty-pins-admin-bundle.js';
await fs.writeFile(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{createBrowserRouter,RouterProvider}from'react-router';import Component from '../app/routes/app.search.settings.jsx';const router=createBrowserRouter([{path:'*',loader:({request})=>fetch('/data'+new URL(request.url).search).then(r=>r.json()),action:async({request})=>fetch('/data',{method:'POST',body:new URLSearchParams(await request.formData())}).then(r=>r.json()),Component}]);createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);`);
await build({entryPoints:[entry],bundle:true,outfile:bundle,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'server-only-stubs',setup(builder){
  builder.onResolve({filter:/(?:db|shopify|searchSettings|searchIndex|searchCollectionPicker)\.server(?:\.js)?$|@shopify\/shopify-app-react-router\/server/},args=>({path:args.path,namespace:'server-stub'}));
  builder.onLoad({filter:/.*/,namespace:'server-stub'},()=>({contents:'export const authenticate={};export const boundary={headers:()=>({})};export const getSearchIndexStatus=()=>({phase:"default"});export const getSearchSettings=()=>{};export const saveSearchSettings=()=>{};export const resetSearchSettings=()=>{};export const listSearchCollections=()=>{};export const listSearchProducts=()=>{};export const validateSelectedSearchProducts=()=>{};export default {}'}));
}}]});
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
  if(url.pathname==='/data'){
    if(req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;settings=validateSearchSettings(JSON.parse(new URLSearchParams(body).get('settings')));saves++;res.end(JSON.stringify({success:true,settings,indexStatus:{phase:'ready'}}));}
    else if(url.searchParams.get('productPicker')==='1'){pickerReads++;const query=url.searchParams.get('q')||'';res.end(JSON.stringify({query,products:products.filter(p=>p.title.toLowerCase().includes(query.toLowerCase())),hasMore:false}));}
    else res.end(JSON.stringify({settings,indexStatus:{phase:'ready'}}));
  }else if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(await fs.readFile(bundle));}
  else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('http://127.0.0.1:'+server.address().port);
  const section=page.getByRole('region',{name:'Pinned products for empty search'});
  await section.getByRole('button',{name:'Choose products',exact:true}).click();
  await section.getByRole('button',{name:'Pin product',exact:true}).first().waitFor();
  await section.getByRole('button',{name:'Pin product',exact:true}).first().click();
  await section.getByRole('button',{name:'Pin product',exact:true}).first().click();
  await section.getByRole('button',{name:'Move Beta Snowboard up',exact:true}).click();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.waitForFunction(()=>document.body.textContent.includes('Search settings saved'));
  assert.deepEqual(settings.emptySearchProducts.map(p=>p.id),[products[1].id,products[0].id]);
  await page.reload();await section.getByRole('button',{name:'Move Beta Snowboard down',exact:true}).waitFor();
  assert.deepEqual(await section.locator('ol li span').allTextContents(),['Beta Snowboard','Alpha Snowboard']);
  await section.getByRole('button',{name:'Choose products',exact:true}).click();
  await section.getByRole('textbox',{name:'Find products'}).fill('Gamma');
  await section.getByRole('button',{name:'Pin product',exact:true}).waitFor();
  assert.equal(await section.locator('ul li').count(),1);
  await section.getByRole('button',{name:'Pin product',exact:true}).click();
  await section.locator('ol li').filter({hasText:'Alpha Snowboard'}).getByRole('button',{name:'Remove',exact:true}).click();
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.waitForTimeout(200);assert.deepEqual(settings.emptySearchProducts.map(p=>p.id),[products[1].id,products[2].id]);
  await page.getByRole('button',{name:/Compact UI A small panel/}).click();assert.equal(await section.count(),0);
  await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.waitForTimeout(200);assert.equal(settings.instantLayout,'compact');
  await page.getByRole('button',{name:/Full screen UI Your original/}).click();await section.waitFor();
  assert.deepEqual(await section.locator('ol li span').allTextContents(),['Beta Snowboard','Gamma Snowboard']);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS empty-search Full screen product picker: select, order, save, reload, search, remove, Compact exclusion, preserve selections, mobile, no browser errors',{saves,pickerReads});
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
