import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,delay:1,priceDelay:0,imageDelay:0,hold:false,productCount:30,realToolbar:true,filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Designers',displayMode:'List',config:{multipleSelection:true}}],globalSettings:{desktopFilterLayout:'horizontal',horizontalFilters:true,showFilterOptionsWithOneItem:true}})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(origin+'/collections/fixture');
 await page.waitForFunction(()=>document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading'));
 const sort=page.locator('.cfp-custom-sort__trigger').first();
 for(const state of ['hover','open']){
  if(state==='hover')await sort.hover();else await sort.click();
  assert.equal(await sort.evaluate(el=>getComputedStyle(el,'::before').content),'none',state+' sort has no thick top decoration');
  assert.equal(await sort.evaluate(el=>getComputedStyle(el).borderTopWidth),'1px');
 }
 await sort.click();
 const pill=page.locator('.cfp-horizontal-pill').filter({has:page.locator('input[name="vendor"]')}).first();
 await pill.locator('.cfp-horizontal-pill__btn').click();
 const pop= pill.locator('.cfp-horizontal-pill__popover');await pop.waitFor({state:'visible'});
 assert.equal(await pop.locator('.cfp-horizontal-pill__popover-title').count(),0);
 assert.equal(await pop.locator('.cfp-horizontal-pill__popover-header').evaluate(el=>getComputedStyle(el).display),'none');
 assert.equal(await pop.getAttribute('aria-labelledby'),await pill.locator('.cfp-horizontal-pill__btn').getAttribute('id'));
 await pop.locator('input[name="vendor"]').first().evaluate(el=>el.click());
 await page.waitForFunction(()=>!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')&&!!document.querySelector('.cfp-horizontal-pill input[name="vendor"]:checked'));
 const clear=pill.locator('.cfp-horizontal-pill__popover-clear');await clear.waitFor({state:'visible'});await clear.click();
 await page.waitForFunction(()=>!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')&&!document.querySelector('.cfp-horizontal-pill input[name="vendor"]:checked'));
 assert.equal(await pill.locator('.cfp-horizontal-pill__popover-title').count(),0);
 assert.equal(await pill.locator('.cfp-horizontal-pill__popover-header').evaluate(el=>getComputedStyle(el).display),'none');
 console.log('PASS sort hover/open keep ordinary 1px border without top stripe; dropdown omits repeated label; select and Clear still work');
}finally{await browser.close();fixture.dispose();}
