import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCompactSearchServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const {server}=await createCompactSearchServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [layout,width] of [['fullscreen',1440],['fullscreen',390],['compact',1280]]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://cdn.shopify.com/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="48" height="58"><rect width="48" height="58" fill="#ddd"/></svg>'}));
  await page.route(/\/api\/search-settings(?:\?.*)?$/,async route=>{const response=await route.fetch(),body=await response.json();body.settings.instantLayout=layout;body.settings.manualSuggestions=[];await route.fulfill({response,json:body});});
  await page.route('**/api/search-navigation?**',route=>route.fulfill({json:{popularSearches:['sequin dress','wedding guest'],collections:[{handle:'formal',image:'https://cdn.shopify.com/formal.jpg'}]}}));
  await page.route('**/search/suggest.json?**',route=>route.fulfill({json:{resources:{results:{collections:[{title:'Formal',handle:'formal',url:'/collections/formal'}],pages:[]}}}}));
  await page.route('**/api/search?**',async route=>{
   const params=new URL(route.request().url()).searchParams;requests.push(Object.fromEntries(params));
   if(params.get('categoryTabs'))return route.fulfill({json:{collections:[{id:'1',handle:'prom',title:'Prom'},{id:'2',handle:'formal',title:'Formal'},{id:'3',handle:'wedding',title:'Wedding'}]}});
   const collection=params.get('collection'),q=params.get('q');
   if(collection==='prom'&&params.get('limit')!=='1')await new Promise(resolve=>setTimeout(resolve,450));
   return route.fulfill({json:{products:[{id:'1',title:(collection||'All')+' '+(q||'default'),handle:'dress',images:['https://cdn.shopify.com/dress.jpg'],priceMin:29,available:true,variants:[]}],matchCount:collection==='prom'?12:collection==='formal'?8:collection==='wedding'?4:42,suggestions:[]}});
  });
  await page.goto(origin);await page.addStyleTag({content:'header{padding:0 16px}header input{max-width:100%;box-sizing:border-box}'});await page.locator('#cfp-main-search-input').waitFor({state:'attached'});await page.locator('header input').click();
  const input=page.locator('#cfp-main-search-input');await input.fill('dress');await page.locator('.cfp-search-result-card').first().waitFor();
  const tabs=page.locator('#cfp-full-category-tabs');
  if(layout==='fullscreen'){
   await tabs.getByRole('tab',{name:'Prom (12)',exact:true}).waitFor();assert.equal(await tabs.getByRole('tab').count(),4);
   const geometry=await page.locator('#cfp-view-all-results').evaluate(el=>({top:el.getBoundingClientRect().top,products:document.getElementById('cfp-search-products').getBoundingClientRect().top,scroll:document.documentElement.scrollWidth}));assert.ok(geometry.top<geometry.products);assert.ok(geometry.scroll<=width,JSON.stringify(geometry));
   await page.locator('.cfp-full-collection-link img').waitFor({state:'attached'});assert.equal(await page.locator('.cfp-full-collection-link img').getAttribute('src'),'https://cdn.shopify.com/formal.jpg');
   assert.equal(await page.locator('#cfp-full-popular-chips button').count(),2);
   await tabs.getByRole('tab',{name:'Prom (12)',exact:true}).click();await tabs.getByRole('tab',{name:'Wedding (4)',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.cfp-search-product-title')?.textContent.includes('wedding dress'));
   await page.waitForTimeout(600);assert.ok((await page.locator('.cfp-search-product-title').textContent()).includes('wedding dress'),'late Prom response must not overwrite Wedding');
   assert.equal(new URL(await page.locator('#cfp-view-all-results').getAttribute('href'),origin).searchParams.get('collections'),'Wedding');
   await tabs.getByRole('tab',{name:'Wedding (4)',exact:true}).press('Home');await page.waitForFunction(()=>document.querySelector('#cfp-full-category-tabs button')?.getAttribute('aria-selected')==='true');
   await page.screenshot({path:`scratch/full-navigation-${width}.png`});
   await page.locator('#cfp-full-popular-chips button').first().click();assert.equal(await input.inputValue(),'sequin dress');
   await input.fill('');await page.waitForTimeout(900);assert.equal(await tabs.isVisible(),false);assert.equal(await page.locator('#cfp-full-results-heading').textContent(),'Products');
  }else{
   await page.waitForTimeout(1100);assert.equal(await tabs.isVisible(),false);assert.equal(await page.locator('#cfp-full-popular').isVisible(),false);
   assert.ok(!requests.some(request=>request.categoryTabs||request.collection));
   assert.equal(await page.locator('#cfp-view-all-results').evaluate(el=>el.parentElement.className),'cfp-search-column-left');
  }
  assert.deepEqual(errors,[]);console.log('PASS '+layout+' '+width+': navigation, thumbnails, chips, top link, stale responses and layout isolation');await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
