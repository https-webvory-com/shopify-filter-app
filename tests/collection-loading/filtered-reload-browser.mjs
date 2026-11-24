import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const cli=process.env.PLAYWRIGHT_MODULE||path.resolve(path.dirname((await fs.readFile('scratch/rea-evaluation/cli-path.txt','utf8')).trim()),'../../playwright-core/index.mjs');
const {chromium}=await import(pathToFileURL(cli).href);
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
const proof={scope:'Actual local renderer and filter route with fixture infrastructure; external requests blocked. No production calls or injected product/facet responses.',cases:[]};
try{
 for(const [width,layout,pageNumber]of [[1440,'vertical',1],[1440,'horizontal',1],[390,'drawer',1],[1440,'vertical',2]]){
  const fields=Object.fromEntries(Array.from({length:60},(_,i)=>[String(i+1),{priceMin:i+1,priceMax:i+1,options:[{name:'Color',values:[i%3===0?'Red':'Blue']},{name:'Size',values:['M']}],variantPrices:[{id:String((i+1)*100),available:true,price:i+1,marketPrices:{US:{price:i+1,currency:'USD'}},option1:i%3===0?'Red':'Blue',option2:'M',imageUrl:'/image/'+(i+1)+'.svg'}]}]));
  const settings=[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'List',config:{}},{id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',displayMode:'List',config:{}},{id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}},{id:'price',isEnabled:true,filterType:'price',label:'Price',displayMode:'List',config:{priceRanges:[{from:0,to:1000,label:'{0} - {1}'}]}}];
  const control=async data=>{const r=await fetch(origin+'/__control',{method:'POST',body:JSON.stringify(data)});assert.equal(r.status,200,await r.text());};
  await control({reset:true,productCount:60,productFields:fields,realToolbar:true,independentFilters:true,cardSnapshots:true,publishedPages:true,noPins:true,noMerchandising:true,priceDelay:0,imageDelay:0,delay:1,filterSettings:settings,globalSettings:{desktopFilterLayout:layout,showFilterOptionsWithOneItem:true},precompute:true,publishFirst50:true});
  await control({apiDelay:3500,facetDelay:600});
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[],productResponses=[];
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(new URL(response.url()).pathname==='/api/filter')productResponses.push(Date.now());});
  for(const phase of ['direct-link','reload']){
   const started=Date.now();productResponses.length=0;
   if(phase==='direct-link')await page.goto(origin+'/collections/fixture?option_Color=Blue&option_Size=M&vendors=Fixture&price%5B%5D=0%3A1000&maxPrice=1000&page='+pageNumber,{waitUntil:'domcontentloaded'});
   else await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.body.classList.contains('cfp-filters-ready')&&document.querySelector('#cfp-sidebar input[name="option-Color"][value="Blue"]')?.checked,null,{timeout:15000});
   const filtersMs=Date.now()-started;
   assert.equal(productResponses.length,0,'saved controls are ready before the delayed product response, including when browser snapshots already display cards');
   for(const [name,value]of [['option-Color','Blue'],['option-Size','M'],['vendor','Fixture'],['price','0:1000']])assert.equal(await page.locator('#cfp-sidebar input[name="'+name+'"][value="'+value+'"]').isChecked(),true);
   assert.equal(await page.locator('#cfp-sidebar .cfp-checkbox__count').count(),0,'collection-wide counts are not presented as filtered counts');
   assert.equal(await page.locator('#cfp-sidebar .cfp-vertical-result-count').textContent().catch(()=>''),'');
   const expectedProducts=pageNumber===1?25:15;
   await page.waitForFunction(count=>!document.querySelector('#cfp-sidebar.cfp-loading')&&!document.querySelector('#cfp-products-container.cfp-loading-retained')&&document.querySelectorAll('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').length===count&&document.querySelector('#cfp-sidebar .cfp-checkbox__count'),expectedProducts,{timeout:25000});
   const readyMs=Date.now()-started;assert.ok(filtersMs<readyMs);
   const ids=await page.locator('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').evaluateAll(nodes=>nodes.map(node=>node.dataset.cfpProductId));
   assert.equal(new Set(ids).size,expectedProducts);assert.equal(await page.locator('.cfp-order-error,.cfp-facet-error,.cfp-no-products').count(),0);
   for(const [name,value]of [['option-Color','Blue'],['option-Size','M'],['vendor','Fixture'],['price','0:1000']])assert.equal(await page.locator('#cfp-sidebar input[name="'+name+'"][value="'+value+'"]').isChecked(),true);
   proof.cases.push({width,layout,pageNumber,phase,filtersMs,readyMs,selectedChoices:4,countsRestored:true,products:ids});
   console.log('PASS '+JSON.stringify({width,layout,pageNumber,phase,filtersMs,readyMs,selectedChoices:4,countsRestored:true}));
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 await fs.writeFile('scratch/filtered-reload-browser-proof-20261124.json',JSON.stringify(proof,null,2));
}finally{await browser.close();fixture.dispose();}
