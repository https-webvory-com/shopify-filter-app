import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const family of ['Arial','Courier New'])for(const width of [390,768,1440]){
 await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,delay:1,priceDelay:0,imageDelay:0,hold:false,productCount:30,realToolbar:true,globalSettings:{desktopFilterLayout:'drawer'}})});
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('**/collections/fixture',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('font:16px Arial','font:16px "'+family+'"').replace('<div class="cfp-sidebar__header">','<div class="cfp-sidebar__header"><h2 class="cfp-sidebar__title">Filters</h2>')});});
 await page.goto(origin+'/collections/fixture');await page.locator('#cfp-drawer-trigger-btn').waitFor({state:'visible'});await page.locator('#cfp-drawer-trigger-btn').click();
 const fonts=await page.evaluate(()=>({body:getComputedStyle(document.body).fontFamily,title:getComputedStyle(document.querySelector('.cfp-sidebar__title')).fontFamily,parent:document.querySelector('#cfp-sidebar').parentElement.tagName}));
 assert.equal(fonts.title,fonts.body);assert.equal(fonts.parent,'BODY');
 await page.locator('#cfp-sidebar').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
 const geometry=await page.locator('#cfp-sidebar').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};});
 if(width<=768){assert.ok(Math.abs(geometry.left)<1,JSON.stringify(geometry));assert.ok(Math.abs(geometry.right-width)<1,JSON.stringify(geometry));assert.ok(Math.abs(geometry.width-width)<1,JSON.stringify(geometry));}else assert.equal(geometry.width,420);
 console.log('PASS '+family+' drawer at '+width+'px: store font and '+(width<=768?'full screen width':'saved desktop width'));await page.close();
}}finally{await browser.close();fixture.dispose();}
