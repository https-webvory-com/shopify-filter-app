import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const family of ['Arial','Courier New']){
 await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,delay:1,priceDelay:0,imageDelay:0,hold:false,productCount:30,realToolbar:true,globalSettings:{desktopFilterLayout:'drawer'}})});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.route('**/collections/fixture',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('font:16px Arial','font:16px "'+family+'"').replace('<div class="cfp-sidebar__header">','<div class="cfp-sidebar__header"><h2 class="cfp-sidebar__title">Filters</h2>')});});
 await page.goto(origin+'/collections/fixture');await page.locator('#cfp-drawer-trigger-btn').waitFor({state:'visible'});await page.locator('#cfp-drawer-trigger-btn').click();
 const fonts=await page.evaluate(()=>({body:getComputedStyle(document.body).fontFamily,title:getComputedStyle(document.querySelector('.cfp-sidebar__title')).fontFamily,parent:document.querySelector('#cfp-sidebar').parentElement.tagName}));
 assert.equal(fonts.title,fonts.body);assert.equal(fonts.parent,'BODY');console.log('PASS drawer heading follows '+family+' after drawer is moved outside the theme section');await page.close();
}}finally{await browser.close();fixture.dispose();}
