import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createFixtureServer} from './server.mjs';
const modulePath=process.env.PLAYWRIGHT_MODULE || path.resolve(path.dirname((await fs.readFile('scratch/rea-evaluation/cli-path.txt','utf8')).trim()),'../../playwright-core/index.mjs');
const {chromium}=await import(pathToFileURL(modulePath).href);
const server=createFixtureServer();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 const page=await browser.newPage();
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/quick-view/index.html`);
 await page.waitForFunction(()=>window.cfpQuickViewInstance);
 await page.evaluate(()=>{
  document.querySelector('#search').setAttribute('data-cfp-quick-view-context','instant-search');
  const copy=document.querySelector('#collection').cloneNode(true);copy.id='search-page';document.body.append(copy);
 });
 for(const width of [390,768,769,1440]){
  await page.setViewportSize({width,height:900});
  for(const desktop of [true,false])for(const collection of [true,false])for(const instant of [true,false]){
   await page.evaluate(({desktop,collection,instant})=>window.cfpQuickViewInstance.configure({showQuickViewCollection:desktop,showQuickViewInstantSearch:desktop,integrations:{showQuickViewCollectionMobile:collection,showQuickViewInstantSearchMobile:instant}}),{desktop,collection,instant});
   for(const [id,enabled]of [['collection',collection],['search-page',collection],['search',instant]]){
    const visible=await page.locator('#'+id).evaluate(button=>getComputedStyle(button).display!=='none');
    assert.equal(visible,width>768?desktop:enabled,`${id} width=${width} desktop=${desktop} collection=${collection} instant=${instant}`);
   }
  }
  console.log(`PASS independent settings and responsive visibility ${width}px`);
 }
 await page.setViewportSize({width:390,height:900});
 await page.evaluate(()=>window.cfpQuickViewInstance.configure({showQuickViewCollectionMobile:false,showQuickViewInstantSearchMobile:true,integrations:{}}));
 const blocked=await page.evaluate(async()=>{const instance=window.cfpQuickViewInstance;await instance.openModal('single',document.querySelector('#collection'));return !instance.overlay.classList.contains('cfp-active');});
 assert.ok(blocked,'hidden Quick View cannot open programmatically');
 await page.locator('#search').click();
 await page.waitForFunction(()=>document.querySelector('.cfp-quick-view-overlay.cfp-active'));
 console.log('PASS disabled collection guard and enabled instant Quick View opens');
 await page.evaluate(()=>window.cfpQuickViewInstance.closeModal());
 await page.evaluate(()=>window.cfpQuickViewInstance.configure({}));
 assert.equal(await page.locator('#collection').evaluate(button=>getComputedStyle(button).display!=='none'),true);
 console.log('PASS legacy settings default to visible');
 const results=await page.evaluate(()=>window.runQuickViewTests());
 for(const result of results)assert.ok(result.passed,`${result.name}: ${result.error}`);
 console.log(`PASS existing Quick View regressions ${results.length}`);
 for(const [file,fn]of [['native.html','runNativeQuickViewTests'],['prestige.html','runPrestigeQuickViewTests']]){
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/quick-view/${file}`);
  const checks=await page.evaluate(fn=>window[fn](),fn);
  for(const check of checks)assert.ok(check.passed,`${check.name}: ${check.error}`);
  console.log(`PASS ${file} existing regressions ${checks.length}`);
 }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
