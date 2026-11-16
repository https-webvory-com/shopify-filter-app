import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCompactSearchServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const {server}=await createCompactSearchServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const {settings}=await(await fetch(origin+'/admin')).json();
 for(const width of [375,390,768,1440]){
  await fetch(origin+'/admin',{method:'POST',body:new URLSearchParams({intent:'save',settings:JSON.stringify({...settings,instantLayout:'fullscreen',collectionLimit:8,minChars:2})})});
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(/^https:\/\/cdn\.shopify\.com\/fixture\.jpg/,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#ddd"/></svg>'}));
  await page.goto(origin);await page.locator('#cfp-main-search-input').waitFor({state:'attached'});await page.locator('header input').click();
  await page.waitForFunction(()=>document.querySelector('.cfp-search-result-card')&&document.getElementById('cfp-search-products').getAttribute('aria-busy')==='false');
  if(width<=768){
   await page.getByText('Popular searches',{exact:true}).waitFor();await page.getByText('Trending products',{exact:true}).waitFor();
   const initial=await page.evaluate(()=>({popular:document.getElementById('cfp-recent-searches-container').getBoundingClientRect().top,collections:document.getElementById('cfp-collections-title').getBoundingClientRect().top,products:document.getElementById('cfp-full-trending-products-title').getBoundingClientRect().top,heading:document.querySelectorAll('.cfp-full-suggestions-heading').length}));
   assert.ok(initial.popular<initial.collections&&initial.collections<initial.products);assert.equal(initial.heading,1);
  }
  await page.locator('#cfp-main-search-input').fill('dress');await page.getByText('Product results (42)',{exact:true}).waitFor();
  const state=await page.evaluate(()=>{
   const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const pills=document.getElementById('cfp-search-collections');return {modal:document.querySelector('.cfp-search-modal').getBoundingClientRect().height,viewport:innerHeight,columns:getComputedStyle(document.getElementById('cfp-search-products')).gridTemplateColumns.split(' ').length,suggestions:rect('cfp-recent-searches-container'),collections:rect('cfp-collections-title'),products:rect('cfp-full-results-header'),pillWidth:pills.clientWidth,pillContent:pills.scrollWidth,pillRows:[...pills.querySelectorAll('a')].map(x=>Math.round(x.getBoundingClientRect().top)),scroll:document.documentElement.scrollWidth,width:innerWidth};
  });
  if(width<=768){
   await page.screenshot({path:`scratch/full-mobile-reference-${width}-20261116.png`});
   assert.equal(state.modal,state.viewport);assert.equal(state.columns,3);assert.ok(state.suggestions.bottom<state.collections.top&&state.collections.top<state.products.top);assert.equal(new Set(state.pillRows).size,1);if(width<768)assert.ok(state.pillContent>state.pillWidth,JSON.stringify(state));assert.ok(state.scroll<=state.width);
   if(state.pillContent>state.pillWidth){await page.locator('#cfp-search-collections').evaluate(x=>{x.scrollLeft=x.scrollWidth;});assert.ok(await page.locator('#cfp-search-collections').evaluate(x=>x.scrollLeft>0));}
   assert.equal(await page.getByRole('button',{name:'Submit search',exact:true}).isVisible(),true);assert.equal(await page.getByRole('button',{name:'Clear search',exact:true}).isVisible(),true);
   await page.screenshot({path:`scratch/full-mobile-reference-${width}-20261116.png`});
   await page.getByRole('button',{name:'Clear search',exact:true}).click();assert.equal(await page.locator('#cfp-main-search-input').inputValue(),'');assert.equal(await page.getByRole('button',{name:'Submit search',exact:true}).isVisible(),false);assert.equal(await page.locator('#cfp-main-search-input').evaluate(x=>x===document.activeElement),true);
   await page.locator('#cfp-main-search-input').fill('dress');await page.getByRole('button',{name:'Submit search',exact:true}).click();await page.waitForURL('**/search?q=dress');
   await page.goto(origin);await page.locator('#cfp-main-search-input').waitFor({state:'attached'});await page.locator('header input').click();await page.getByRole('button',{name:'Close search',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.cfp-search-modal').classList.contains('cfp-open'));
  }else {assert.equal(state.columns,4);assert.equal(await page.getByRole('button',{name:'Submit search',exact:true}).isVisible(),false);assert.equal(await page.locator('#cfp-full-trending-products-title').isVisible(),false);}
  assert.deepEqual(errors,[]);await page.close();console.log('PASS Full screen reference '+width+': section order, scrollable pills, product grid, controls, submission/close, desktop preserved');
 }
}finally{await browser.close();await new Promise(r=>{server.close(r);server.closeAllConnections();});}
