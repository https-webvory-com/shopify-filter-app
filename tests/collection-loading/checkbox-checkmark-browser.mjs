import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const cli=(await fs.readFile('scratch/rea-evaluation/cli-path.txt','utf8')).trim();
const {chromium}=await import(pathToFileURL(path.resolve(path.dirname(cli),'../../playwright-core/index.mjs')).href);
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try {for(const layout of ['vertical','horizontal','drawer'])for(const width of [390,1440]) {
 await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,realToolbar:true,delay:1,priceDelay:0,imageDelay:0,filterSettings:[{id:'price',isEnabled:true,filterType:'price',label:'Price',displayMode:'List',config:{priceRanges:[{from:0,to:100,label:'{0} - {1}'}]}}],globalSettings:{desktopFilterLayout:layout}})});
 const page=await browser.newPage({viewport:{width,height:900}});await page.goto(origin+'/collections/fixture');
 await page.locator('input[name="price"]').first().waitFor({state:'attached'});
 const drawer=page.locator('#cfp-drawer-trigger-btn');if(await drawer.isVisible())await drawer.click();
 if(layout==='horizontal'&&width===1440)await page.locator('#cfp-horizontal-filters .cfp-horizontal-pill__btn').filter({hasText:'Price'}).click();
 const label=page.locator('label.cfp-checkbox:visible').filter({has:page.locator('input[name="price"]')}).first();
 if(!await label.isVisible()){const price=page.locator('.cfp-group').filter({has:page.locator('input[name="price"]')}).locator('button').first();await price.click();}
 await label.click();
 const box=await label.locator('.cfp-checkbox__box').evaluate(el=>({image:getComputedStyle(el).backgroundImage,color:getComputedStyle(el).backgroundColor,checked:el.parentElement.querySelector('input').checked}));
 assert.equal(box.checked,true);assert.ok(box.image.includes('data:image/svg+xml'),JSON.stringify({layout,width,box}));assert.match(box.image,/stroke='white'|stroke=%27white%27|stroke=\\?"white/);assert.notEqual(box.color,'rgb(255, 255, 255)');
 console.log('PASS '+layout+' '+width+': selected price checkbox retains white checkmark');await page.close();
}}finally{await browser.close();fixture.dispose();}
