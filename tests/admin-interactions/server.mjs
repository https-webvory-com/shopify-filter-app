import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { build } from "esbuild";
import ts from "typescript";

const files = (await fs.readdir("app/routes")).filter(
  (f) => /^app\..*\.jsx$/.test(f) && !f.startsWith("app.api."),
);
const imports = files
  .map((f, i) => `import Page${i} from '../../app/routes/${f}';`)
  .join("\n");
const routes = files.map((file, i) => ({
  file,
  component: `Page${i}`,
  path:
    "/" +
    file
      .replace(/\.jsx$/, "")
      .replace(/\._index$/, "")
      .replace(/\$id/g, ":id")
      .replaceAll(".", "/"),
}));
const entry = `${imports}
import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter, RouterProvider} from 'react-router';
import AdminLoadingBoundary from '../../app/components/ui/AdminLoadingBoundary';
window.auditEvents=[]; window.auditErrors=[];
window.addEventListener('error',e=>window.auditErrors.push(e.message));
window.addEventListener('unhandledrejection',e=>window.auditErrors.push(String(e.reason)));
window.shopify={toast:{show:(...args)=>window.auditEvents.push({toast:args})},modal:{show(){},hide(){}},resourcePicker:async()=>[]};
window.confirm=()=>true; window.alert=m=>window.auditEvents.push({alert:m}); window.open=(...args)=>window.auditEvents.push({open:args});
const rule={id:'rule-1',name:'Summer dresses',status:true,applyToAll:false,applyToSearchType:'both',searchQueries:['dress'],collections:['Summer'],products:[{id:'product-1',title:'Red dress',handle:'red-dress',image:null}],conditions:[],createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-01T00:00:00Z'};
const rule2={...rule,id:'rule-2',name:'Winter coats',status:false,searchQueries:['coat'],collections:['Winter'],products:[]};
const settings={};
const storeData={collection:['Summer','Winter'],vendor:['Acme'],product_type:['Dress'],tags:['Sale'],inventory_locations:['Warehouse'],options:{Color:['Red','Blue'],Size:['S','M']}};
const group={id:'group-1',name:'Default filter',isDefault:true,status:true,collections:[],filters:[{id:'filter-1',label:'Color',filterType:'option',filterKey:'Color',displayMode:'list',enabled:true,order:0,settings:{}}]};
const common={redirects:[],themeId:'1',customization:null,rule:null,defaultParams:{searchQueries:['dress'],collections:['Summer']},allCollections:['Summer','Winter'],pinningRules:[rule,rule2],merchandisingRules:[rule,rule2],collections:[{id:'1',title:'Summer'}],shopifyCollections:[{id:'1',title:'Summer'}],shopifyVendors:['Acme'],shopifyOptions:{Color:['Red','Blue']},shopifyLocations:['Warehouse'],shopifyProductTypes:['Dress'],shopifyTags:['Sale'],shopifyProducts:[{title:'Red dress',image:null}],shopifySkus:[],shopifyBarcodes:[],lookupWarning:null,synonyms:[{id:'syn-1',word:'dress',synonyms:'gown'}],settings,integrationsSettings:{},themes:[{id:'gid://shopify/OnlineStoreTheme/1',themeId:'1',name:'Test theme',role:'MAIN',updatedAt:'2026-09-01',canPreview:true}],shop:'fixture.myshopify.com',rules:[{id:'merge-1',filterType:'option',filterKey:'Color',targetValue:'Red',sourceValues:['Scarlet','Crimson'],status:true,enabled:true}],optionNames:['Color','Size'],storeData,pagination:{currentPage:1,totalPages:2,totalItems:21,sort:'newest',search:''},group,groups:[group],detectedOptions:['Color','Size'],syncedProductsCount:20,isSyncingBackground:false,lastSyncedAt:null,syncProgress:null,resumableJob:null};
window.auditSetGroups = groups => { common.groups = groups; };
window.auditRoutes=${JSON.stringify(routes.map((r) => ({ path: r.path, file: r.file })))};
function ErrorView(){return <div data-audit-error>Route rendering failed</div>}
const routes=[${routes.map((r) => `{path:${JSON.stringify(r.path)},Component:()=> <AdminLoadingBoundary><${r.component}/></AdminLoadingBoundary>,ErrorBoundary:ErrorView,loader:({params,request})=>({...common,storeData:new URL(request.url).pathname.includes('/filters/groups/')?{...common.storeData,vendors:[{value:'Acme',count:1}],productTypes:[{value:'Dress',count:1}],tags:[{value:'Sale',count:1}],titles:[{value:'Red dress',count:1}],locations:[],options:{Color:[{value:'Red',count:1},{value:'Blue',count:1}]}}:common.storeData,shopifyCollections:new URL(request.url).pathname.includes('/filters/')?['Summer','Winter']:common.shopifyCollections,merchandisingRules:common.merchandisingRules.map(rule=>({...rule,ruleType:new URL(request.url).pathname.includes('/search/')?'search':'collection'})),rule:params.id&&params.id!=='new'?rule:null,defaultParams:params.id==='new'?{...common.defaultParams,...(new URL(request.url).searchParams.get('applyToAll')==='true'?{applyToAll:true,searchQueries:[]}: {})}:common.defaultParams}),action:async({request})=>{const values=Object.fromEntries(await request.formData());window.auditEvents.push({action:${JSON.stringify(r.path)},values});if((${JSON.stringify(r.path)}==='/app/search/synonyms'&&['add','update','delete'].includes(values.intent))||values.actionType==='toggleRule')await new Promise(resolve=>setTimeout(resolve,400));return values.intent==='search'?{products:[{id:'product-2',title:'Blue dress',handle:'blue-dress'}],totalCount:1}:{success:true,intent:values.intent||values.actionType,action:values.actionType};}}`).join(",")},
{path:'/app/api/stats',loader:()=>({activeProducts:20,totalProducts:20,draftProducts:0,archivedProducts:0,allCollections:2,publishedCollections:2,smartCollections:0})},{path:'/app/api/orders-sync-status',loader:()=>({status:'IDLE'})},
{path:'*',Component:()=> <div data-audit-error>Unknown route</div>}];
let root; window.auditMount=async (url)=>{if(root)root.unmount();history.replaceState({},'',url);window.auditEvents=[];window.auditErrors=[];window.auditRouter=createMemoryRouter(routes,{initialEntries:[url]});root=createRoot(document.getElementById('root'));root.render(<RouterProvider router={window.auditRouter}/>);await new Promise(r=>setTimeout(r,150));return {url:window.auditRouter.state.location.pathname,error:!!document.querySelector('[data-audit-error]'),controls:document.querySelectorAll('button,a,input,select,s-button').length};};
window.auditReady=window.auditMount('/app/search');
`;
const bundle = await build({
  stdin: {
    contents: entry,
    resolveDir: path.resolve("tests/admin-interactions"),
    loader: "jsx",
  },
  bundle: true,
  write: false,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "client-fixtures",
      setup(b) {
        b.onResolve({ filter: /^@shopify\/app-bridge-react$/ }, () => ({
          path: "bridge",
          namespace: "audit",
        }));
        b.onLoad({ filter: /.*/, namespace: "audit" }, () => ({
          contents: "export function useAppBridge(){return window.shopify}",
          loader: "js",
        }));
        b.onLoad(
          { filter: /app[\\/]routes[\\/].*\.jsx$/ },
          async ({ path: file }) => {
            const source = await fs.readFile(file, "utf8");
            const ast = ts.createSourceFile(
              file,
              source,
              ts.ScriptTarget.Latest,
              true,
              ts.ScriptKind.JSX,
            );
            const kept = ast.statements.filter((s) => {
              if (
                ts.isImportDeclaration(s) &&
                /\.server|graphql\/|shopify-app-react-router/.test(
                  s.moduleSpecifier.text,
                )
              )
                return false;
              if (
                ts.isVariableStatement(s) &&
                s.declarationList.declarations.some((d) =>
                  ["loader", "action", "headers"].includes(d.name.getText(ast)),
                )
              )
                return false;
              if (
                ts.isFunctionDeclaration(s) &&
                ["ErrorBoundary"].includes(s.name?.text)
              )
                return false;
              return true;
            });
            return {
              contents: kept.map((s) => s.getText(ast)).join("\n"),
              loader: "jsx",
              resolveDir: path.dirname(file),
            };
          },
        );
      },
    },
  ],
});
http
  .createServer((req, res) => {
    if (req.url === "/audit.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles[0].text);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><title>Local admin interaction audit</title><style>body{font-family:Arial;margin:20px}s-page,s-stack,s-box,s-section,s-banner{display:block;margin:8px}button,s-button{cursor:pointer}ui-title-bar{display:none}</style></head><body><div id="root"></div><script src="/audit.js"></script></body></html>',
    );
  })
  .listen(4187, "127.0.0.1", () =>
    console.log(
      "Local fixture audit: http://127.0.0.1:4187 (no production requests)",
    ),
  );
