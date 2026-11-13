import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createCompactSearchServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const {server}=await createCompactSearchServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [layout,width] of [['compact',1280],['compact',390],['fullscreen',1280]]){
  const page=await browser.newPage({viewport:{width,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route(/\/api\/search-settings(?:\?.*)?$/,async route=>{const response=await route.fetch(),body=await response.json();body.settings.instantLayout=layout;await route.fulfill({response,json:body});});
  await page.route('**/api/search?**',async route=>{const q=new URL(route.request().url()).searchParams.get('q');if(q?.startsWith('zz-no-match'))return route.fulfill({json:{products:[],suggestions:[],matchCount:0,totalCount:0}});return route.continue();});
  await page.goto(origin);await page.addStyleTag({content:'header{padding:0 16px}header input{max-width:100%;box-sizing:border-box}'});await page.locator('#cfp-main-search-input').waitFor({state:'attached'});await page.locator('header input').click();
  const query='zz-no-match " <img src=x onerror=alert(1)>';
  await page.locator('#cfp-main-search-input').fill(query);
  const state=page.locator('.cfp-search-no-results');await state.waitFor({state:'visible'});
  assert.ok((await state.textContent()).includes(query),'query is shown literally');assert.equal(await state.locator('img').count(),0,'query cannot inject markup');
  assert.equal(await page.locator('.cfp-search-error').count(),0);assert.equal(await page.locator('#cfp-view-all-results').isVisible(),false);
  if(layout==='compact'){
   assert.ok((await state.textContent()).includes('No products found for'));assert.ok((await state.textContent()).includes('Check the spelling or try a different keyword.'));
   const geometry=await state.evaluate(el=>({width:el.getBoundingClientRect().width,grid:el.parentElement.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth}));assert.ok(geometry.width>=geometry.grid-2&&geometry.scroll<=width,JSON.stringify(geometry));
   await state.getByRole('button',{name:'Clear search',exact:true}).click();await page.locator('#cfp-compact-browse').waitFor({state:'visible'});assert.equal(await page.locator('#cfp-main-search-input').inputValue(),'');assert.equal(await page.locator('#cfp-compact-tabs [role="tab"]').count(),4);
  }else assert.ok((await state.textContent()).includes('No matches found for'));
  assert.deepEqual(errors,[]);console.log('PASS '+layout+' '+width+': accurate empty state, escaped query, '+(layout==='compact'?'clear restores collection menu':'existing message retained'));await page.close();
 }
}finally{await browser.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}
