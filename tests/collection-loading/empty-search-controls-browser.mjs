import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const layout of ['vertical','horizontal','drawer'])for(const width of [1440,390]){
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,delay:1,priceDelay:0,imageDelay:0,hold:false,productCount:30,realToolbar:true,noMatchQuery:'zz-no-matches',filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}}],globalSettings:{desktopFilterLayout:layout,showFilterOptionsWithOneItem:true}})});
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/search?q=zz-no-matches');await page.locator('.cfp-no-products').waitFor();
  assert.equal(await page.locator('#cfp-custom-sort').isVisible(),false);assert.equal(await page.locator('#cfp-drawer-trigger-btn').isVisible(),false);assert.equal(await page.locator('#cfp-sidebar').isVisible(),false);
  assert.ok((await page.locator('.cfp-no-products').textContent()).includes('zz-no-matches'));
  await page.goto(origin+'/search?q=dress&vendors=missing');await page.locator('#cfp-reset-inline').waitFor();
  assert.equal(await page.locator('#cfp-custom-sort').isVisible(),false);
  await page.locator('#cfp-reset-inline').click();
  await page.waitForFunction(()=>document.querySelectorAll('.cfp-product-card--reveal').length>0&&!document.body.classList.contains('cfp-empty-search-results'));
  assert.equal(await page.locator('#cfp-custom-sort').isVisible(),true);
  if(width===390||layout==='drawer')assert.equal(await page.locator('#cfp-drawer-trigger-btn').isVisible(),true);
  await page.goto(origin+'/collections/fixture?vendors=missing');await page.locator('.cfp-no-products').waitFor();
  assert.equal(await page.locator('#cfp-custom-sort').isVisible(),true,'collection controls retain existing behavior');
  assert.deepEqual(errors,[]);console.log('PASS '+layout+' '+width+': empty search hides controls, results restore them, collections unchanged');await page.close();
 }
}finally{await browser.close();fixture.dispose();}
