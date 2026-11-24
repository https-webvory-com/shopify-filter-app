import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';

const cli=process.env.PLAYWRIGHT_MODULE||path.resolve(path.dirname((await fs.readFile('scratch/rea-evaluation/cli-path.txt','utf8')).trim()),'../../playwright-core/index.mjs');
const {chromium}=await import(pathToFileURL(cli).href);
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
const proof={scope:'Actual local renderer and filter loader with fixture infrastructure; all external requests blocked. Immediate filter requests cancel obsolete selections; only server candidate checking is optimized.',cases:[]};
try{
 for(const width of [1440,390]){
  const productFields=Object.fromEntries(Array.from({length:60},(_,i)=>[String(i+1),{
   priceMin:i+1,priceMax:i+1,
   options:[{name:'Color',values:[i%3===0?'Red':'Blue']},{name:'Size',values:['M']}],
   variantPrices:[{id:String((i+1)*100),available:true,price:i+1,marketPrices:{US:{price:i+1,currency:'USD'}},option1:i%3===0?'Red':'Blue',option2:'M',imageUrl:'/image/'+(i+1)+'.svg'}],
  }]));
  const filterSettings=[
   {id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'List',config:{}},
   {id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',displayMode:'List',config:{}},
   {id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}},
   {id:'price',isEnabled:true,filterType:'price',label:'Price',displayMode:'List',config:{priceRanges:[{from:0,to:1000,label:'{0} - {1}'}]}},
  ];
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,productCount:60,productFields,realToolbar:true,delay:1,priceDelay:0,imageDelay:0,noPins:true,noMerchandising:true,precompute:true,filterSettings,globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true}})});
  const context=await browser.newContext({viewport:{width,height:950}});const blockedExternal=[];
  const page=await context.newPage(),requests=[],cancelled=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{
   if(!route.request().url().startsWith(origin+'/')){blockedExternal.push(route.request().url());return route.abort();}
   return route.continue();
  });
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/filter')requests.push({url:r.url(),at:Date.now()});});
  page.on('requestfailed',r=>{if(new URL(r.url()).searchParams.get('responseProfile')==='fast-cards-v1')cancelled.push(r.failure()?.errorText);});
  await page.goto(origin+'/collections/fixture');
  await page.waitForFunction(()=>document.body.classList.contains('cfp-filters-ready')&&!document.querySelector('#cfp-sidebar.cfp-loading')&&document.querySelectorAll('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').length===25);
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({apiDelay:400,facetDelay:700})});requests.length=0;
  const started=Date.now();
  const finalResponse=page.waitForResponse(response=>{
   const url=new URL(response.url()),params=url.searchParams;
   return url.pathname==='/api/filter'&&params.get('responseProfile')==='fast-cards-v1'&&params.get('options[Color][]')==='Blue'&&params.get('options[Size][]')==='M'&&params.get('vendor[]')==='Fixture'&&params.get('price[]')==='0:1000';
  });
  for(const [name,value]of [['option-Color','Blue'],['option-Size','M'],['vendor','Fixture'],['price','0:1000']]){
   await page.evaluate(({name,value})=>{const input=[...document.querySelectorAll('#cfp-sidebar input[type=checkbox]')].find(i=>i.name===name&&i.value===value);if(!input)throw Error('Missing choice '+name);input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));},{name,value});
   await page.waitForTimeout(35);
  }
  await (await finalResponse).finished();
  await page.waitForFunction(()=>!document.querySelector('#cfp-products-container.cfp-loading-retained')&&new URL(location.href).searchParams.get('option_Size')==='M'&&document.querySelectorAll('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').length===25);
  const cardsMs=Date.now()-started;
  assert.equal(await page.locator('#cfp-sidebar').evaluate(node=>node.classList.contains('cfp-loading')),true,'ready cards do not wait for the slower facet response');
  await page.waitForFunction(()=>!document.querySelector('#cfp-sidebar.cfp-loading'));
  const cardRequests=requests.filter(r=>new URL(r.url).searchParams.get('responseProfile')==='fast-cards-v1');
  assert.equal(cardRequests.length,4,'every selection starts its request immediately');
  assert.equal(cancelled.length,3,'obsolete intermediate requests are cancelled');
  assert.ok(cancelled.every(error=>error.includes('ABORTED')));
  const selected=new URL(cardRequests.at(-1).url).searchParams;
  for(const [key,value]of [['options[Color][]','Blue'],['options[Size][]','M'],['vendor[]','Fixture'],['price[]','0:1000']])assert.equal(selected.get(key),value);
  const fullUrl=new URL(cardRequests.at(-1).url);fullUrl.searchParams.set('responseProfile','collection-v1');
  const full=await(await fetch(fullUrl)).json();assert.equal(full.totalCount,40);
  const first=await page.locator('#cfp-products-container .cfp-product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.cfpProductId));
  assert.deepEqual(first,full.products.map(p=>String(p.id)),'fast cards preserve the canonical full response IDs and order');
  await page.locator('#cfp-load-more-btn').click();await page.waitForFunction(()=>document.querySelectorAll('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').length===40);
  const all=await page.locator('#cfp-products-container .cfp-product-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.cfpProductId));
  assert.equal(new Set(all).size,40);assert.deepEqual(all.slice(0,25),first);
  assert.equal(await page.locator('.cfp-order-error,.cfp-facet-error,.cfp-no-products').count(),0);
  assert.deepEqual(errors,[]);
  proof.cases.push({width,cardsMs,cardRequests:cardRequests.length,cancelledRequests:cancelled.length,products:all.length,exactOrder:true,cardsBeforeFacets:true,blockedExternal,externalRequestsAllowed:0});
  console.log('PASS '+JSON.stringify(proof.cases.at(-1)));await context.close();
 }
 await fs.writeFile('scratch/collection-multi-filter-browser-proof-20261124.json',JSON.stringify(proof,null,2));
}finally{await browser.close();fixture.dispose();}
