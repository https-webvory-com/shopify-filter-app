import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCompactSearchServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const {server}=await createCompactSearchServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
let fail=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/search?**',async route=>fail?route.fulfill({status:503,contentType:'application/json',body:'{"error":"Unavailable"}'}):route.continue());
try{
  for(const width of [1280,390]){
    await page.setViewportSize({width,height:850});await page.goto(origin);await page.addStyleTag({content:'header{padding:0 16px}header input{max-width:100%;box-sizing:border-box}'});await page.locator('#cfp-main-search-input').waitFor({state:'attached'});await page.locator('header input').click();
    await page.locator('.cfp-search-result-card').first().waitFor({state:'attached'});await page.locator('#cfp-main-search-input').fill('dress');await page.locator('#cfp-view-all-results').waitFor();
    fail=true;await page.locator('#cfp-main-search-input').fill('test');const state=page.getByRole('status').filter({hasText:"We couldn't load your search"});await state.waitFor();
    assert.equal(await page.locator('#cfp-collections-title').isVisible(),false);assert.equal(await page.locator('#cfp-compact-products-title').isVisible(),false);assert.equal(await page.locator('#cfp-view-all-results').isVisible(),false);
    const geometry=await state.evaluate(el=>{const r=el.getBoundingClientRect(),grid=el.parentElement.getBoundingClientRect(),p=el.querySelector('p').getBoundingClientRect();return {width:r.width,grid:grid.width,height:r.height,textHeight:p.height,scroll:document.documentElement.scrollWidth};});
    assert.ok(geometry.width>=geometry.grid-2,JSON.stringify(geometry));assert.ok(geometry.width>280);assert.ok(geometry.textHeight<45);assert.ok(geometry.height<260);assert.ok(geometry.scroll<=width);
    await page.screenshot({path:'scratch/compact-search-error-'+(width===1280?'desktop':'mobile')+'.png'});
    fail=false;await state.getByRole('button',{name:'Try again',exact:true}).click();await page.locator('.cfp-search-result-card').first().waitFor();assert.equal(await state.count(),0);assert.equal(await page.locator('#cfp-search-products').getAttribute('aria-busy'),'false');
    assert.deepEqual(errors,[]);console.log('PASS Compact error '+width+': full-width readable state, no orphan headings/overflow, retry restores products');
  }
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
