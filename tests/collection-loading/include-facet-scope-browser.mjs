import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const cli=process.env.PLAYWRIGHT_MODULE||path.resolve(path.dirname((await fs.readFile('scratch/rea-evaluation/cli-path.txt','utf8')).trim()),'../../playwright-core/index.mjs');
const {chromium}=await import(pathToFileURL(cli).href);
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
const proof={scope:'Actual local renderer, publication and filter route with fixture infrastructure; external requests blocked.',cases:[]};
try{
 for(const [width,layout]of [[1440,'vertical'],[1440,'horizontal'],[390,'drawer']]){
  const productFields=Object.fromEntries(['White','Ivory','Champagne','Silver','Black','White'].map((color,i)=>[String(i+1),{collections:['gid://shopify/Collection/'+(i>=4?'2':'1')],tags:i>=4?['TopWedding']:[],options:[{name:'Color',values:[color]}],variantPrices:[{id:String((i+1)*100),available:true,price:100,option1:color,marketPrices:{US:{price:100,currency:'USD'}},imageUrl:'/image/'+(i+1)+'.svg'}]}]));
  const control=await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,productCount:6,productFields,enforceCollections:true,ruleConditions:[{action:'Include',field:'Tags',operator:'contains',value:'TopWedding'}],delay:0,imageDelay:0,priceDelay:0,noPins:true,realToolbar:true,independentFilters:true,cardSnapshots:true,publishedPages:true,globalSettings:{desktopFilterLayout:layout,showProductCount:false},filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'List',config:{useManualValues:true,manualValues:['White','Ivory','Champagne','Silver','Black']}}],precompute:true,publishFirst50:true})});assert.equal(control.status,200,await control.text());
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.goto(origin+'/collections/fixture',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.body.classList.contains('cfp-filters-ready')&&document.querySelectorAll('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').length===6,null,{timeout:15000});
   const read=()=>page.locator('#cfp-sidebar input[name="option-Color"]').evaluateAll(nodes=>nodes.map(i=>i.value).sort());
   const expected=['Champagne','Ivory','Silver','White'];assert.deepEqual(await read(),expected);
   await page.evaluate(()=>{const input=document.querySelector('#cfp-sidebar input[name="option-Color"][value="White"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.waitForFunction(()=>!document.querySelector('#cfp-sidebar.cfp-loading')&&document.querySelectorAll('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').length===1,null,{timeout:15000});
   assert.equal((await read()).includes('Black'),false);assert.equal(await page.locator('#cfp-sidebar input[name="option-Color"][value="White"]').isChecked(),true);assert.equal(await page.locator('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').getAttribute('data-cfp-product-id'),'gid://shopify/Product/1');
   await page.locator('.cfp-breadcrumb-clear').evaluate(node=>node.click());
   await page.waitForFunction(()=>document.querySelectorAll('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').length===6&&!document.querySelector('#cfp-sidebar.cfp-loading'),null,{timeout:15000});
   assert.deepEqual(await read(),expected);assert.equal(await page.locator('.cfp-order-error,.cfp-facet-error').count(),0);assert.deepEqual(errors,[]);
   proof.cases.push({width,layout,choices:expected,merchantIncludeCards:6,whiteMatchesOnlyCollectionProduct:true,clearRestoresAllCards:true,externalRequestsAllowed:0});console.log('PASS '+JSON.stringify(proof.cases.at(-1)));
  }catch(error){console.log('FIXTURE FAILURE '+JSON.stringify(await page.evaluate(()=>({errorMessages:[...document.querySelectorAll('.cfp-order-error,.cfp-facet-error')].map(n=>n.textContent),classes:document.body.className,filters:document.querySelector('#cfp-sidebar')?.textContent,cards:document.querySelectorAll('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').length,html:document.querySelector('#cfp-products-container')?.innerHTML.slice(0,800)}))));console.log('FIXTURE QUERIES '+JSON.stringify(fixture.facetRequests.map(q=>({filter:q.filter,facets:q.facets}))));console.log('FIXTURE DOCUMENTS '+JSON.stringify(fixture.documents.map(p=>({id:p.id,collections:p.collections,tags:p.tags}))));throw error;}
  finally{await context.close();}
 }
 await fs.writeFile('scratch/include-facet-scope-browser-proof-20261124.json',JSON.stringify(proof,null,2));
}finally{await browser.close();fixture.dispose();}
