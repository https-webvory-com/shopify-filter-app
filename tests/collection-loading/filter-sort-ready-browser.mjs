import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const template of ['collection','search'])for(const layout of ['drawer','vertical','horizontal'])for(const width of [390,1440]) {
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,realToolbar:true,productCount:30,precompute:true,headRenderer:template==='collection',early:true,assetDelay:template==='collection'?1000:0,delay:1,priceDelay:0,imageDelay:0,filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}}],globalSettings:{integrations:{desktopFilterLayout:layout},showFilterOptionsWithOneItem:true}})});
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  if(template==='search')await page.route('**/api/filter?**',async route=>{
   const response=await route.fetch();
   if(new URL(route.request().url()).searchParams.get('responseProfile')!=='search-fast-cards-v1')await new Promise(resolve=>setTimeout(resolve,1200));
   await route.fulfill({response});
  });
  await page.addInitScript(()=>{
   window.filterSortFrames=[];
   const sample=()=>{
    const sort=document.getElementById('cfp-custom-sort');
    if(sort)window.filterSortFrames.push({at:performance.now(),sort:getComputedStyle(sort).visibility!=='hidden'&&sort.getClientRects().length>0,filters:document.body.classList.contains('cfp-filters-ready')});
    requestAnimationFrame(sample);
   };requestAnimationFrame(sample);
  });
  await page.goto(origin+(template==='collection'?'/collections/fixture':'/search?q=dress'),{waitUntil:'commit'});
  await page.waitForFunction(()=>document.querySelector('#cfp-first-row img,#cfp-products-container .cfp-product-card--reveal'),null,{timeout:20000});
  assert.equal(await page.locator('#cfp-custom-sort').evaluate(el=>getComputedStyle(el).visibility),'hidden','products remain available before filter controls');
  await page.waitForFunction(()=>document.body.classList.contains('cfp-filters-ready')&&getComputedStyle(document.getElementById('cfp-custom-sort')).visibility!=='hidden',null,{timeout:20000});
  const frames=await page.evaluate(()=>window.filterSortFrames);
  assert.ok(frames.some(frame=>!frame.filters&&!frame.sort),'initial controls are held');
  assert.equal(frames.some(frame=>frame.sort&&!frame.filters),false,'sorting never appears ahead of filters');
  assert.equal(await page.locator('#cfp-custom-sort').getAttribute('inert'),null);
  assert.equal(await page.locator('#cfp-custom-sort').getAttribute('aria-hidden'),null);
  await page.locator('#cfp-custom-sort-trigger').click();
  await page.locator('#cfp-custom-sort-dropdown .cfp-custom-sort__option[data-value="price-ascending"]').waitFor({state:'visible'});
  assert.deepEqual(errors,[]);
  console.log(`PASS ${template} ${layout} ${width}: products first, filter/sort together, sorting usable`);
  await page.close();
 }
 for(const [path,settings] of [['/collections/fixture',[]],['/search?q=',[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}}]]]) {
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,realToolbar:true,delay:1,priceDelay:0,imageDelay:0,filterSettings:settings})});
  const page=await browser.newPage();await page.goto(origin+path);
  await page.waitForFunction(()=>document.querySelector('.cfp-product-card--reveal')&&!document.getElementById('cfp-custom-sort').hasAttribute('inert'),null,{timeout:20000});
  assert.equal(await page.locator('#cfp-custom-sort').isVisible(),true);
  console.log('PASS sorting remains available after '+(settings.length?'empty-query search':'an empty filter configuration'));
  await page.close();
 }
} finally {await browser.close();fixture.dispose();}
