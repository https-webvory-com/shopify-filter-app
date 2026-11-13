import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [query,failFirst,early] of [['dress',false,false],['dress',true,false],['',false,false],['dress',false,true]]){
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,early,delay:1,imageDelay:0,realToolbar:true,filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}}],globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true}})});
  const page=await browser.newPage(),errors=[],starts=[];let cardFinished=0,fullReads=0;page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/filter?**',async route=>{
   const url=new URL(route.request().url()),cards=url.searchParams.get('responseProfile')==='search-fast-cards-v1';
   starts.push({cards,time:Date.now()});
   if(!cards&&++fullReads<=2&&failFirst)return route.fulfill({status:503,json:{error:'Temporarily unavailable'}});
   const response=await route.fetch();
   if(cards){await new Promise(resolve=>setTimeout(resolve,1200));cardFinished=Date.now();}
   await route.fulfill({response});
  });
  await page.goto(origin+'/search?q='+query);
  await page.waitForFunction(()=>document.querySelectorAll('.cfp-product-card--reveal').length>0);
  if(query)assert.ok(starts.find(row=>!row.cards).time<cardFinished-700,'canonical filters start before the delayed cards finish');
  if(failFirst){await page.locator('.cfp-facet-error button').evaluate(el=>el.click());}
  await page.waitForFunction(()=>document.querySelector('#cfp-sidebar .cfp-group')&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading'));
  assert.equal(fullReads,!query?0:failFirst?3:1,'reuse the parallel response, with one automatic retry and then explicit recovery; empty queries need no second read');
  assert.equal(await page.locator('#cfp-sidebar input[name="vendor"]').count()>0,true);
  assert.equal(await page.locator('.cfp-product-card--reveal').count(),25);
  assert.deepEqual(errors,[]);
  console.log('PASS parallel search facets, preserved cards/counts'+(failFirst?' and local retry':' without duplicate requests'));
  await page.unrouteAll({behavior:'ignoreErrors'});await page.close();
 }
}finally{await browser.close();fixture.dispose();}
