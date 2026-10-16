import fs from 'node:fs/promises';
import http from 'node:http';
import { build } from 'esbuild';
import { loadModule, loadRanking } from '../search/helpers/search-ranking.mjs';
import { availablePins } from '../../app/utils/availablePins.server.js';
import { pinProductSearchFilter } from '../../app/utils/pinProductSearch.server.js';
import { reorderSearchPins } from '../../app/utils/reorderSearchPins.js';
const shop = 'pin-fixture.myshopify.com', gid = id => 'gid://shopify/Product/' + id;
const docs = Array.from({length:15}, (_,i) => ({id:String(i+1),shop,title:(i<12?'Green':'Red')+' Dress '+(i+1),handle:'dress-'+(i+1),status:'ACTIVE',
  images:[],options:[{name:'Color',values:[i<12?'Green':'Red']}],variantPrices:[{id:String(i+1),option1:i<12?'Green':'Red',available:true,price:10}]}));
let rule = {id:'fixture',name:'Green dresses',searchQueries:['green dresses'],ruleType:'search',status:true,createdAt:new Date().toISOString(),applyToAll:false,applyToSearchType:'both',products:[]};
const rows = docs.map(p=>({...p,id:gid(p.id),status:'active',variants:p.variantPrices}));
function eligible(where) {
  return rows.filter(p => (!where.id?.in || where.id.in.includes(p.id)) && (!where.id?.notIn || !where.id.notIn.includes(p.id))
    && (!where.title?.contains || p.title.toLowerCase().includes(where.title.contains.toLowerCase()))
    && (where.AND||[]).every(c=>!c.id?.in||c.id.in.includes(p.id)));
}
const prisma = {product:{findMany:async({where,skip=0,take})=>eligible(where).slice(skip,take?skip+take:undefined),count:async({where})=>eligible(where).length},
  pinnedProductRule:{findFirst:async()=>rule,create:async({data})=>{rule={id:'fixture',...data};return rule;},update:async({data})=>{rule={...rule,...data};return rule;}}};
const ranking=await loadRanking(prisma,async(q,options)=>{const matches=docs.filter(p=>p.title.toLowerCase().includes(q.toLowerCase().includes('green')?'green':'red'));
  return {hits:matches.slice(options.offset||0,(options.offset||0)+options.limit),estimatedTotalHits:matches.length};});
const picker=await loadModule('app/services/searchPicker.server.js',{'./queryParser.server.js':{parseQuery:async()=>null},'./searchRanking.server.js':ranking});
const admin=await loadModule('app/routes/app.search.pinning.$id.jsx',{'react-router':{redirect:()=>({redirect:true})},react:{},'@shopify/app-bridge-react':{},'@shopify/shopify-app-react-router/server':{},
  '../shopify.server':{authenticate:{admin:async()=>({session:{shop}})}},'../db.server':{default:prisma},'../utils/availablePins.server.js':{availablePins},
  '../utils/pinProductSearch.server':{pinProductSearchFilter},'../utils/reorderSearchPins.js':{reorderSearchPins},'../services/searchPicker.server.js':picker,'../components/merchandising/PinSearchField':{}});
await fs.mkdir('scratch',{recursive:true});
await fs.writeFile('scratch/pinning-admin-entry.jsx',`import React from 'react';import{createRoot}from'react-dom/client';import{createBrowserRouter,RouterProvider,redirect}from'react-router';import Component from '../app/routes/app.search.pinning.$id.jsx';import Index from '../app/routes/app.search.pinning._index.jsx';
function endpoint(request){const u=new URL(request.url),out=new URL('/admin',u);out.search=u.search;out.searchParams.set('ruleId',u.pathname.endsWith('/new')?'new':'fixture');return out.pathname+out.search;}
const router=createBrowserRouter([{path:'/list-ui',loader:async()=>({pinningRules:await(await fetch('/list-state')).json()}),Component:Index},{path:'*',loader:({request})=>fetch(endpoint(request)).then(r=>r.json()),action:async({request})=>{const d=await fetch(endpoint(request),{method:'POST',body:new URLSearchParams(await request.formData())}).then(r=>r.json());return d.redirect?redirect('/admin-ui'):d;},Component}]);createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);`);
await build({entryPoints:['scratch/pinning-admin-entry.jsx'],outfile:'scratch/pinning-admin.js',bundle:true,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'fixture',setup(b){
  b.onResolve({filter:/(?:db|shopify|searchPicker)\.server(?:\.js)?$|@shopify\/shopify-app-react-router\/server|@shopify\/app-bridge-react/},args=>({path:args.path,namespace:'stub'}));
  b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const useAppBridge=()=>({toast:{show:()=>{}}});export const authenticate={};export const boundary={headers:()=>({})};export const searchPickerProducts=()=>{};export default {};'}));
}}]});
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/admin') {const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=new Request(url,{method:req.method,...(req.method==='POST'?{body:Buffer.concat(chunks),headers:req.headers}:{})});
    const result = await (req.method==='POST'?admin.action:admin.loader)({request,params:{id:url.searchParams.get('ruleId')||'fixture'}});
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result instanceof Response ? await result.json() : result));return;}
  if(url.pathname==='/list-state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(rule.listRules||[rule]));return;}
  if(url.pathname==='/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(rule));return;}
  if(url.pathname==='/__control'&&req.method==='POST'){const chunks=[];for await(const chunk of req)chunks.push(chunk);Object.assign(rule,JSON.parse(Buffer.concat(chunks).toString()));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(rule));return;}
  if(url.pathname==='/pinning-admin.js'){res.setHeader('Content-Type','application/javascript');res.end(await fs.readFile('scratch/pinning-admin.js'));return;}
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial} s-page{display:block}</style></head><body><div id="root"></div><script>window.browserErrors=[];addEventListener("error",e=>browserErrors.push(e.message));addEventListener("unhandledrejection",e=>browserErrors.push(String(e.reason)));</script><script src="/pinning-admin.js"></script></body></html>');
}catch(error){res.statusCode=500;res.end(error.stack);}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
await fs.writeFile('scratch/pinning-fixture.json',JSON.stringify({origin,pid:process.pid}));console.log(origin);
const timer=setInterval(async()=>{if(await fs.access('scratch/pinning-fixture-stop-'+process.pid).then(()=>true,()=>false)){clearInterval(timer);server.closeAllConnections();server.close();}},500);
