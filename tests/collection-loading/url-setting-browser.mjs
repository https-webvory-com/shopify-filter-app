import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const template of ['search','collection'])for(const enabled of [true,false]){
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,delay:1,priceDelay:0,imageDelay:0,hold:false,productCount:30,realToolbar:true,filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}}],globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true}})});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(flag=>{window.cfpSearchSettings={changeBrowserUrl:flag,pageSize:25};},enabled);
  await page.goto(origin+(template==='search'?'/search?q=dress&keep=1':'/collections/fixture?keep=1'));
  await page.waitForFunction(()=>document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading'));
  const before=page.url();await page.locator('#cfp-sidebar input[name="vendor"]').first().evaluate(el=>el.click());
  await page.waitForFunction(()=>document.querySelector('#cfp-sidebar input[name="vendor"]')?.checked&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading'));
  const updates=template==='collection'||enabled;
  assert.equal(new URL(page.url()).searchParams.has('vendors'),updates,template+' filter URL with setting '+enabled);if(!updates)assert.equal(page.url(),before);
  await page.locator('#cfp-load-more-btn').click();await page.waitForFunction(()=>document.querySelectorAll('.cfp-product-card--reveal').length===30);
  assert.equal(new URL(page.url()).searchParams.get('page'),updates?'2':null,template+' pagination URL');
  await page.locator('.cfp-custom-sort__option[data-value="price-ascending"]').first().evaluate(el=>el.click());
  await page.waitForFunction(()=>document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading'));
  assert.equal(new URL(page.url()).searchParams.get('sort_by'),updates?'price-ascending':null,template+' sort URL');assert.equal(new URL(page.url()).searchParams.get('keep'),'1');if(template==='search')assert.equal(new URL(page.url()).searchParams.get('q'),'dress');
  assert.deepEqual(errors,[]);console.log('PASS '+template+' URL setting '+enabled+': filtering, pagination, sorting, existing query parameters');await page.close();
 }
}finally{await browser.close();fixture.dispose();}
