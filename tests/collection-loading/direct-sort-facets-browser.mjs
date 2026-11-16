import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';import {createLoadingServer} from './server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),fixture=await createLoadingServer();await new Promise(r=>fixture.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const ranges=[{from:'0',to:'10',label:'{0} - {1}'},{from:'10',to:'20',label:'From {0}'},{from:'20',to:'30',label:'{0} - {1}'},{from:'30',to:'40',label:'{0} - {1}'},{from:'40',to:'',label:'{0} - {1}'}];
 await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,delay:1,imageDelay:0,priceDelay:0,realToolbar:true,noPins:true,noMerchandising:true,marketPriceReady:true,filterSettings:[{id:'price',isEnabled:true,filterType:'price',label:'Price',displayMode:'List',config:{priceRanges:ranges,advanced:{sortType:'Label - AZ'}}}],globalSettings:{desktopFilterLayout:'drawer',showFilterOptionsWithOneItem:true}})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),responses=[];
 page.on('response',r=>{if(!r.url().includes('/api/filter?'))return;r.json().then(b=>responses.push({profile:new URL(r.url()).searchParams.get('responseProfile'),cards:b.cfpCards?.directSort,full:b.cfpDirectSort})).catch(()=>{});});
 const wait=async()=>{await page.locator('#cfp-drawer-trigger-btn').waitFor({state:'visible',timeout:15000});await page.waitForFunction(()=>document.querySelectorAll('#cfp-sidebar input[name="price"]').length===5&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading'));assert.equal(await page.locator('.cfp-facet-error').count(),0);};
 for(const sort of ['price-ascending','price-descending','best-selling']){
  await page.goto(origin+'/collections/fixture?sortBy='+sort);await wait();
  const values=await page.locator('#cfp-sidebar input[name="price"]').evaluateAll(rows=>rows.map(r=>r.value));assert.deepEqual(values,['0:10','10:20','20:30','30:40','40:Infinity']);
  const text=await page.locator('#cfp-sidebar').innerText();assert.ok(text.includes('From $40'));assert.ok(!text.includes('Infinity'));console.log('PASS fresh '+sort+' filters, numeric bands, open-ended label');
  await page.reload();await wait();console.log('PASS refreshed '+sort+' filter button');
 }
 await page.goto(origin+'/collections/fixture?sortBy=price-ascending');await wait();await page.locator('#cfp-drawer-trigger-btn').click();const selectedRead=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/filter'&&u.searchParams.get('responseProfile')==='collection-v1'&&u.searchParams.getAll('price[]').includes('10:20');});await page.locator('#cfp-sidebar input[name="price"]').nth(1).evaluate(el=>el.click());await selectedRead;await page.waitForFunction(()=>new URL(location.href).searchParams.getAll('price[]').includes('10:20'));await wait();
 assert.ok(responses.some(r=>r.cards?.version===1),'actual API marks direct cards');assert.ok(responses.some(r=>r.full?.version===1),'actual API marks canonical direct facets');console.log('PASS selected price range retains filters and direct-sort contract');await page.close();
}finally{await browser.close();fixture.dispose();}
