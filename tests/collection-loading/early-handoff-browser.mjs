import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const cli=(await fs.readFile('scratch/rea-evaluation/cli-path.txt','utf8')).trim();
const {chromium}=await import(pathToFileURL(path.resolve(path.dirname(cli),'../../playwright-core/index.mjs')).href);
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const layout of ['drawer','vertical','horizontal'])for(const width of [390,1440]){
 await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,realToolbar:true,productCount:30,precompute:true,headRenderer:true,early:true,hold:true,assetDelay:1800,apiDelay:0,priceDelay:0,imageDelay:0,globalSettings:{integrations:{desktopFilterLayout:layout}}})});
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/collections/fixture',{waitUntil:'commit'});
 await page.waitForFunction(()=>document.querySelector('#cfp-first-row img')?.complete&&document.querySelector('#cfp-first-row img')?.naturalWidth>0,null,{timeout:15000});
 const early=await page.evaluate(()=>{const image=document.querySelector('#cfp-first-row img');window.retainedEarlyImage=image;const r=image.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,widget:!!window._cfpInitStarted};});
 assert.equal(early.widget,false);
 await page.waitForFunction(()=>document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.getElementById('cfp-first-row'),null,{timeout:15000});
 const full=await page.evaluate(()=>{const image=document.querySelector('#cfp-products-container .cfp-product-card__image--primary'),r=image.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,retained:image===window.retainedEarlyImage,ready:image.complete&&image.naturalWidth>0};});
 assert.equal(full.retained,true,'the loaded image node must survive the early/full handoff');assert.equal(full.ready,true);
 for(const key of ['x','y','width'])assert.ok(Math.abs(early[key]-full[key])<=1,JSON.stringify({layout,width,early,full}));
 if(layout==='drawer'&&width===1440){
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({hold:false,delay:1})});
  await page.route(url=>url.pathname==='/api/filter'&&url.searchParams.get('sortBy')==='price-ascending',async route=>{
   const response=await route.fetch(),data=await response.json();
   if(Array.isArray(data.products))data.products=data.products.map(product=>String(product.id).split('/').pop()==='1'?{...product,pinnedProductImage:'/image/2.svg'}:product);
   await route.fulfill({response,json:data});
  });
  await page.locator('#cfp-custom-sort-trigger').click();await page.locator('.cfp-custom-sort__option[data-value="price-ascending"]').click();
  await page.waitForFunction(()=>{const img=document.querySelector('[data-cfp-product-id="gid://shopify/Product/1"],[data-cfp-product-id="1"]')?.querySelector('img.cfp-product-card__image--primary');return img&&img.src.endsWith('/image/2.svg')&&img.complete&&img.naturalWidth>0;},null,{timeout:15000});
  assert.equal(await page.evaluate(()=>document.querySelector('[data-cfp-product-id="gid://shopify/Product/1"],[data-cfp-product-id="1"]')?.querySelector('img.cfp-product-card__image--primary')===window.retainedEarlyImage),false,'a genuinely changed selected image must replace the old photo');
 }
 assert.deepEqual(errors,[]);console.log('PASS '+layout+' '+width+': early image retained, loaded and aligned with final grid');await page.close();
}}finally{await browser.close();fixture.dispose();}
