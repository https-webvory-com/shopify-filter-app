import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCompactSearchServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const {server}=await createCompactSearchServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const {settings}=await(await fetch(origin+'/admin')).json();
 await fetch(origin+'/admin',{method:'POST',body:new URLSearchParams({intent:'save',settings:JSON.stringify({...settings,instantLayout:'fullscreen',collectionLimit:8,minChars:2})})});
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https:\/\/cdn\.shopify\.com\/fixture\.jpg/,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#999"/></svg>'}));
  await page.route('**/api/search?**',async route=>{
   const q=new URL(route.request().url()).searchParams.get('q');
   if(['prom','blue'].includes(q))await new Promise(r=>setTimeout(r,900));
   if(q==='productfail')return route.fulfill({status:503,json:{error:'Fixture failure'}});
   await route.continue();
  });
  await page.route('**/search/suggest.json?**',async route=>{
   const q=new URL(route.request().url()).searchParams.get('q');
   await route.fulfill({json:{resources:{results:{collections:q==='nocollection'?[]:Array.from({length:8},(_,i)=>({title:q+' Collection '+(i+1),handle:q+'-'+(i+1)}))}}}});
  });
  await page.goto(origin);await page.locator('#cfp-main-search-input').waitFor({state:'attached'});await page.locator('header input').click();
  await page.waitForFunction(()=>document.querySelector('.cfp-search-result-card')&&document.querySelector('#cfp-search-products').getAttribute('aria-busy')==='false');
  await page.evaluate(()=>{window.initialCard=document.querySelector('.cfp-search-result-card');window.collectionPaints=0;new MutationObserver(rows=>{collectionPaints+=rows.filter(x=>x.type==='childList').length;}).observe(document.getElementById('cfp-search-collections'),{childList:true});});
  await page.locator('#cfp-main-search-input').fill('prom');
  await page.getByText('Collection results',{exact:true}).waitFor();
  assert.equal(await page.locator('#cfp-search-collections a').count(),8);
  assert.ok(await page.evaluate(()=>document.querySelector('.cfp-search-result-card')===initialCard),'keep existing cards while product request is pending');
  assert.equal(await page.locator('#cfp-search-products .cfp-skeleton-card').count(),0);
  await page.getByText('Product results (42)',{exact:true}).waitFor();
  assert.equal(await page.locator('#cfp-view-all-results').textContent(),'View all');
  assert.equal(await page.locator('#cfp-view-all-results').evaluate(x=>x.parentElement.id),'cfp-full-results-header');
  assert.equal(await page.evaluate(()=>collectionPaints),1,'collections must not repaint when products arrive');
  assert.equal(await page.locator('#cfp-main-search-input').evaluate(x=>x===document.activeElement),true);
  const geometry=await page.locator('#cfp-full-results-header').evaluate(x=>({header:x.getBoundingClientRect().bottom,grid:document.getElementById('cfp-search-products').getBoundingClientRect().top,scroll:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(geometry.header<=geometry.grid&&geometry.scroll<=geometry.viewport);
  await page.locator('#cfp-main-search-input').fill('blue');await page.waitForFunction(()=>document.getElementById('cfp-search-products').getAttribute('aria-busy')==='true');
  await page.locator('#cfp-main-search-input').fill('red');
  await page.waitForFunction(()=>document.querySelector('.cfp-search-product-title')?.textContent.startsWith('red'));
  await page.waitForTimeout(1100);assert.ok((await page.locator('.cfp-search-product-title').first().textContent()).startsWith('red'),'slow older response cannot replace current query');
  await page.locator('#cfp-main-search-input').fill('nocollection');
  await page.waitForFunction(()=>document.querySelector('.cfp-search-product-title')?.textContent.startsWith('nocollection'));
  assert.equal(await page.locator('#cfp-collections-title').isVisible(),false);assert.equal(await page.locator('#cfp-search-collections a').count(),0);
  await page.locator('#cfp-main-search-input').fill('nothing');await page.getByText('Product results (0)',{exact:true}).waitFor();
  assert.equal(await page.locator('#cfp-search-collections a').count(),8,'collection matches remain visible when there are no matching products');
  await page.locator('#cfp-main-search-input').fill('productfail');await page.locator('.cfp-search-error').waitFor();
  await page.getByText('Collection results',{exact:true}).waitFor();assert.equal(await page.locator('#cfp-search-collections a').count(),8,'product failures must not suppress valid collection results');
  assert.equal(await page.locator('#cfp-recent-searches-container').isVisible(),false,'do not leave suggestions from an older successful query beside a product error');
  await page.locator('#cfp-main-search-input').fill('dress');await page.getByText('Product results (42)',{exact:true}).waitFor();
  await page.screenshot({path:`scratch/full-typed-results-${width}-20261116.png`});
  await page.locator('#cfp-main-search-input').fill('');await page.getByText('Trending collections',{exact:true}).waitFor();
  assert.equal(await page.locator('#cfp-full-results-header').isVisible(),false);assert.equal(await page.locator('#cfp-view-all-results').count(),1);
  assert.deepEqual(errors,[]);await page.close();console.log('PASS Full typed '+width+': early 8 collection pills, retained cards, current-query guard, product header/link, empty/error recovery, clear restores trending');
 }
}finally{await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
