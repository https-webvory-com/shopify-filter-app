import fs from 'node:fs/promises';
import http from 'node:http';
import {build} from 'esbuild';
import {DEFAULT_SEARCH_SETTINGS,validateSearchSettings} from '../../app/utils/searchSettings.js';

export async function createEditorFixture({legacyPins=[]}={}){
  const state={settings:structuredClone(DEFAULT_SEARCH_SETTINGS),rules:[],saves:0};state.settings.emptySearchProducts=legacyPins;
  const products=[1,2,3].map(id=>({id:'gid://shopify/Product/'+id,title:['Alpha Snowboard','Beta Snowboard','Gamma Snowboard'][id-1],image:'',available:id!==2}));
  const entry='scratch/search-editors-entry-'+process.pid+'.jsx',bundle='scratch/search-editors-bundle-'+process.pid+'.js';
  await fs.writeFile(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{createBrowserRouter,RouterProvider,redirect}from'react-router';import Settings from '../app/routes/app.search.settings.jsx';import Pins from '../app/routes/app.search.pinning._index.jsx';import Editor from '../app/routes/app.search.pinning.$id.jsx';const loader=view=>({request,params})=>{const url=new URL(request.url);url.searchParams.set('view',view);if(params.id)url.searchParams.set('id',params.id);return fetch('/fixture'+url.search).then(r=>r.json());};const action=view=>async({request,params})=>{const body=new URLSearchParams(await request.formData());body.set('view',view);if(params.id)body.set('id',params.id);const data=await fetch('/fixture',{method:'POST',body}).then(r=>r.json());return data.redirect?redirect(data.redirect):data;};const router=createBrowserRouter([{path:'/app/search/settings',loader:loader('settings'),action:action('settings'),Component:Settings},{path:'/app/search/pinning',loader:loader('pins'),action:action('pins'),Component:Pins},{path:'/app/search/pinning/:id',loader:loader('editor'),action:action('editor'),Component:Editor}]);createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);`);
  const names=['invalidateShop','getSearchSettings','saveSearchSettings','resetSearchSettings','getSearchIndexStatus','listSearchCollections','listSearchProducts','validateSelectedSearchProducts','getEmptySearchProductState','availablePins','pinProductImageFallbacks','pinProductSearchFilter','pinProductTagSuggestions','searchPickerProducts','searchPickerPage','legacyEmptySearchProducts','saveEmptySearchPin'];
  await build({entryPoints:[entry],bundle:true,outfile:bundle,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'server-stubs',setup(builder){builder.onResolve({filter:/\.server(?:\.js)?$|@shopify\/shopify-app-react-router\/server|@shopify\/app-bridge-react/},args=>({path:args.path,namespace:'server-stub'}));builder.onLoad({filter:/.*/,namespace:'server-stub'},()=>({contents:'export const authenticate={};export const boundary={headers:()=>({})};export const useAppBridge=()=>({toast:{show:()=>{}},saveBar:{show:()=>{},hide:()=>{}}});'+names.map(name=>'export const '+name+'=()=>{};').join('')+'export default {};'}));}}]});
  const server=http.createServer(async(req,res)=>{
    try{const url=new URL(req.url,'http://localhost');res.setHeader('Content-Type','application/json');
      if(url.pathname==='/app/product-picker'){const query=url.searchParams.get('q')||'';res.end(JSON.stringify({query,products:products.filter(p=>p.title.toLowerCase().includes(query.toLowerCase())),hasMore:false,stockOnly:true}));return;}
      if(url.pathname==='/fixture'){
        if(req.method==='POST'){
          let body='';for await(const chunk of req)body+=chunk;const form=new URLSearchParams(body);
          if(form.get('view')==='settings'){state.settings=validateSearchSettings(JSON.parse(form.get('settings')));state.saves++;res.end(JSON.stringify({success:true,settings:state.settings,indexStatus:{phase:'ready'}}));}
          else if(form.get('intent')==='search'){const query=form.get('q')||'';res.end(JSON.stringify({products:products.filter(p=>p.title.toLowerCase().includes(query.toLowerCase())),totalCount:products.length,targetQueryKey:form.get('targetQueries')||'[]',nonMatchingPinnedIds:[]}));}
          else{const selected=JSON.parse(form.get('products'));state.rules=selected.length?[{id:'empty',name:'Empty search pin',shop:'fixture.myshopify.com',ruleType:'search',searchQueries:[''],applyToAll:false,applyToSearchType:'instant',status:true,products:selected,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]:[];state.settings.emptySearchProducts=[];state.saves++;res.end(JSON.stringify({redirect:'/app/search/pinning'}));}
        }else if(url.searchParams.get('productPicker')==='1'){const query=url.searchParams.get('q')||'';res.end(JSON.stringify({query,products:products.filter(p=>p.title.toLowerCase().includes(query.toLowerCase())),hasMore:false,stockOnly:true}));}
        else if(url.searchParams.get('collectionPicker')==='1')res.end(JSON.stringify({query:'',collections:[],hasMore:false,nextCursor:''}));
        else if(url.searchParams.get('view')==='pins')res.end(JSON.stringify({pinningRules:state.rules,legacyEmptyProducts:state.rules.length?[]:state.settings.emptySearchProducts}));
        else if(url.searchParams.get('view')==='editor'){const rule=state.rules[0]||{name:'Empty search pin',searchQueries:[''],applyToAll:false,applyToSearchType:'instant',products:state.settings.emptySearchProducts};res.end(JSON.stringify({rule,defaultParams:null,pinImageFallbacks:{},stockOnly:true}));}
        else res.end(JSON.stringify({settings:state.settings,indexStatus:{phase:'ready'}}));
      }else if(url.pathname==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(await fs.readFile(bundle));}
      else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');}
    }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {state,products,origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
