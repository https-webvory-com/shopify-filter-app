import http from 'node:http';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import * as schema from '../../app/utils/searchSettings.js';
import { loadModule } from '../search/helpers/search-ranking.mjs';

export async function createCompactSearchServer() {
  const groups = ['Top Searches','Trending','Occasion'];
  const resource = (id,title) => ({id:`gid://shopify/Collection/${id}`,title,handle:title.toLowerCase().replaceAll(' ','-'),image:{originalSrc:'https://cdn.shopify.com/fixture.jpg'}});
  const resources = ['Women','Men','Sport','Kids'].map((title,index)=>resource(index+1,title));
  const children = Array.from({length:8},(_,i)=>resource(i+10,'Style '+(i+1)));
  const collection = c => ({...c,image:c.image.originalSrc});
  const storedCollections = [...resources,...children,...Array.from({length:50},(_,i)=>resource(i+100,'Saved Collection '+(i+1)))].map(c=>({...collection(c),productCount:25}));
  const pickerRequests=[];let pickerDelay=0;
  const collectionService = {listSearchCollections:async(_shop,{query='',after=''})=>{pickerRequests.push({query,after});await new Promise(resolve=>setTimeout(resolve,pickerDelay));const matches=storedCollections.filter(c=>(c.title+' '+c.handle).toLowerCase().includes(query.toLowerCase()));const start=after?matches.findIndex(c=>c.id===after)+1:0;const collections=matches.slice(start,start+40);return {query,after,collections,hasMore:matches.length>start+40,nextCursor:matches.length>start+40?collections.at(-1).id:''};}};
  let saved = schema.validateSearchSettings({...schema.DEFAULT_SEARCH_SETTINGS,instantLayout:'compact',manualSuggestions:['sweater dress','matching sets','pants','homecoming dresses','going out','sweaters'],compactCollections:resources.map((r,i)=>({...collection(r),groups:groups.map(title=>({title,collections:children.map(c=>({...collection(c),title:r.title+' '+c.title,handle:r.handle+'-'+c.handle}))}))}))});
  const requests=[];
  let settingsDelay=0,settingsFailures=0,settingsCalls=0,searchDelay=0;
  const service = {getSearchSettings:async()=>saved,saveSearchSettings:async(_shop,v)=>{saved=schema.validateSearchSettings(v);return saved;},resetSearchSettings:async()=>{saved=null;}};
  const admin = await loadModule('app/routes/app.search.settings.jsx',{'../services/searchCollectionPicker.server.js':collectionService,'../components/CompactSearchSettings':{default:()=>null},'../components/SearchConfigurationLayout':{default:()=>null},react:{},'react-router':{},'@shopify/shopify-app-react-router/server':{boundary:{}},'../shopify.server':{authenticate:{admin:async()=>({session:{shop:'compact-fixture.myshopify.com'}})}},'../services/searchSettings.server.js':service,'../utils/searchSettings.js':schema});
  const bundle = await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{createBrowserRouter,RouterProvider}from'react-router';import Component from './app/routes/app.search.settings.jsx';const router=createBrowserRouter([{path:'*',loader:({request})=>fetch('/admin'+new URL(request.url).search).then(r=>r.json()),action:async({request})=>fetch('/admin',{method:'POST',body:new URLSearchParams(await request.formData())}).then(r=>r.json()),Component}]);createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'server-stubs',setup(b){b.onResolve({filter:/(?:shopify|searchSettings|searchIndex|searchCollectionPicker)\.server(?:\.js)?$|@shopify\/shopify-app-react-router\/server/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const authenticate={};export const boundary={headers:()=>({})};export const getSearchIndexStatus=()=>({phase:"default"});export const getSearchSettings=()=>{};export const saveSearchSettings=()=>{};export const resetSearchSettings=()=>{};export const listSearchCollections=()=>{};export default {};'}));}}]});
  const server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url,'http://127.0.0.1');
    const respond=(body)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
    if(url.pathname==='/admin'){
      const chunks=[];for await(const c of req)chunks.push(c);
      const request=new Request(url,{method:req.method,...(req.method==='POST'?{body:Buffer.concat(chunks),headers:req.headers}:{})});
      return respond(await(req.method==='POST'?admin.action:admin.loader)({request}));
    }
    if(url.pathname==='/__state')return respond({saved,requests,settingsCalls,pickerRequests});
    if(url.pathname==='/__settings-control'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const control=JSON.parse(Buffer.concat(chunks).toString());
      settingsDelay=control.delay||0;settingsFailures=control.failures||0;settingsCalls=0;
      searchDelay=control.searchDelay||0;
      pickerDelay=control.pickerDelay||0;
      return respond({ok:true});
    }
    if(url.pathname==='/api/search-settings'){
      settingsCalls++;const snapshot=saved,failed=settingsFailures>0;if(failed)settingsFailures--;
      await new Promise(resolve=>setTimeout(resolve,settingsDelay));
      if(failed){res.statusCode=503;return respond({error:'Fixture unavailable'});}
      return respond({settings:snapshot});
    }
    if(url.pathname==='/api/search-redirect')return respond({redirectUrl:null});
    if(url.pathname==='/api/search'){
      requests.push(Object.fromEntries(url.searchParams));
      const q=url.searchParams.get('q')||'';
      const suggestions=q==='silver'?['Silver Dress','Silver','<link rel="stylesheet" href="https://assets.reviews.io/style.css"><script>document.write("silver")</script>','&lt;div&gt;Silver widget&lt;/div&gt;','silver '+ 'x'.repeat(400)]:q==='nothing'?[]:[q+' dress',q+' style'];
      await new Promise(r=>setTimeout(r,searchDelay||(q==='slow'?500:40)));
      return respond({products:q==='nothing'?[]:Array.from({length:6},(_,i)=>({id:String(i+1),title:(q||'Popular')+' Dress '+(i+1),handle:'dress-'+(i+1),vendor:'Fixture',images:['https://cdn.shopify.com/fixture.jpg'],priceMin:29,priceMax:29,available:true,variants:[{id:String(i+1),price:29,available:true}]})),suggestions,matchCount:q==='nothing'?0:42,contextualPricingApplied:true});
    }
    if(url.pathname==='/collections.json'||url.pathname==='/search/suggest.json'){
      if(searchDelay)await new Promise(resolve=>setTimeout(resolve,searchDelay));
      return respond({collections:children,resources:{results:{collections:children,pages:url.searchParams.get('resources[type]')==='page'?[{title:'Dress styling guide',url:'/pages/dress-styling-guide'}]:[]}}});
    }
    if(url.pathname.startsWith('/assets/')){const name=url.pathname.slice(8);if(!['instantSearch.js','instantSearch.css','searchSettings.js'].includes(name)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',name.endsWith('.css')?'text/css':'application/javascript');return res.end((await fs.readFile('extensions/theme-extension/assets/'+name,'utf8')).replaceAll('https://aisearchfilter.webvory.com',''));}
    if(url.pathname==='/admin.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].text);}
    res.setHeader('Content-Type','text/html');
    const common=`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px Arial}header{height:100px;display:flex;align-items:center;justify-content:flex-end;padding:0 120px;background:white}header input{width:360px;padding:12px;border:1px solid #ddd;border-radius:24px}main{padding:40px;background:#f7f3ee;min-height:120vh}</style>`;
    if(url.pathname==='/admin-ui')return res.end(`<!doctype html><html><head>${common}</head><body><div id="root"></div><script>window.pickerResults=[];window.pickerCalls=[];window.shopify={resourcePicker:async options=>{pickerCalls.push(options);return pickerResults.shift();}};window.fixtureResources=${JSON.stringify(resources)};window.fixtureChildren=${JSON.stringify(children)};</script><script src="/admin.js"></script></body></html>`);
    res.end(`<!doctype html><html><head>${common}<link rel="stylesheet" href="/assets/instantSearch.css"><script>window.Shopify={shop:'compact-fixture.myshopify.com',country:'US',currency:{active:'USD'},locale:'en',routes:{root:'/'}};window.cfpMarketPricing={apply:async(products,callback)=>products.forEach((p,i)=>callback({...p,_marketPricingUnavailable:false},i))};window.browserErrors=[];addEventListener('error',e=>browserErrors.push(e.message));addEventListener('unhandledrejection',e=>browserErrors.push(String(e.reason)));</script></head><body><header><input aria-label="Header search" type="search" name="q" placeholder="Search"><button aria-label="Country">US</button></header><main><h1>Search preview</h1><p>Local fixture using the app’s actual search assets. Collections and products are test data.</p></main><script src="/assets/searchSettings.js" defer></script><script src="/assets/instantSearch.js" defer></script></body></html>`);
  }catch(error){res.statusCode=500;res.end(error.stack);}});
  return {server};
}

if(process.argv.includes('--serve')){const {server}=await createCompactSearchServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;await fs.writeFile('scratch/compact-search-fixture.json',JSON.stringify({origin,pid:process.pid}));console.log(origin);}
