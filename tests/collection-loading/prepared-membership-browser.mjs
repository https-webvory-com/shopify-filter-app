import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const cli=(await fs.readFile('scratch/rea-evaluation/cli-path.txt','utf8')).trim();
const {chromium}=await import(pathToFileURL(path.resolve(path.dirname(cli),'../../playwright-core/index.mjs')).href);
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
const proof={scope:'Actual local renderer and loader. External requests blocked. Ranking service deliberately unavailable after the initial complete collection.',cases:[]};
try{
 for(const width of [1440,390]){
  const productFields=Object.fromEntries(Array.from({length:60},(_,i)=>[String(i+1),{
   options:[{name:'Color',values:[i%3===0?'Red':'Blue']},{name:'Size',values:['M']}],
   variantPrices:[{id:String((i+1)*100),available:true,price:i+1,marketPrices:{US:{price:i+1,currency:'USD'}},option1:i%3===0?'Red':'Blue',option2:'M',imageUrl:'/image/'+(i+1)+'.svg'}],
  }]));
  const filterSettings=[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'List',config:{}},
   {id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',displayMode:'List',config:{}},
   {id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}},
   {id:'price',isEnabled:true,filterType:'price',label:'Price',displayMode:'List',config:{priceRanges:[{from:0,to:1000,label:'{0} - {1}'}]}}];
  const control=await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,orderMissing:false,rankingFailure:null,productCount:60,productFields,filterSettings,delay:0,imageDelay:0,priceDelay:0,membershipProof:'snapshot-v1:'+'a'.repeat(64),cardSnapshots:true,publishedPages:true,publishFirst50:true,precompute:true,realToolbar:true,independentFilters:true,globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true}})});
  assert.equal(control.status,200,await control.text());
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(origin+'/collections/fixture',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.body.classList.contains('cfp-filters-ready')&&!document.querySelector('#cfp-sidebar.cfp-loading')&&document.querySelectorAll('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').length===25);
   const builds=fixture.state.builds;fixture.state.rankingFailure='throw';fixture.state.orderMissing=true;fixture.state.apiDelay=300;fixture.state.facetDelay=800;
   const apply=async(choices,waitForFacets=true)=>{
    const response=page.waitForResponse(r=>r.status()===200&&new URL(r.url()).searchParams.get('responseProfile')==='fast-cards-v1');
    response.catch(()=>{});
    await page.evaluate(choices=>{for(const [name,value,checked=true]of choices){const input=[...document.querySelectorAll('#cfp-sidebar input[type=checkbox]')].find(i=>i.name===name&&i.value===value);if(!input)throw Error('Missing '+name+'='+value);input.checked=checked;input.dispatchEvent(new Event('change',{bubbles:true}));}},choices);
    assert.equal(await page.locator('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)').first().isVisible(),true);
    assert.equal(await page.locator('#cfp-products-container .cfp-skeleton-card').count(),0);
    const received=await response,body=await received.json();body.requestUrl=received.url();assert.equal(body.debug.membershipReuse,'reused');assert.equal(body.debug.rankingPreparationMs,0);
    await page.waitForFunction(ids=>!document.querySelector('#cfp-products-container.cfp-loading-retained')&&JSON.stringify([...document.querySelectorAll('#cfp-products-container .cfp-product-card:not(.cfp-skeleton-card)')].map(n=>n.dataset.cfpProductId))===JSON.stringify(ids),body.products.map(p=>String(p.id)));
    if(waitForFacets)await page.waitForFunction(()=>!document.querySelector('#cfp-sidebar.cfp-loading'));
    assert.equal(fixture.state.builds,builds);return body;
   };
   const first=await apply([['option-Color','Blue']],false);
   assert.equal(await page.locator('#cfp-sidebar').evaluate(n=>n.classList.contains('cfp-loading')),true);
   const second=await apply([['option-Size','M']],false);
   assert.equal(new URL(second.requestUrl).searchParams.get('membershipParentToken'),first.rankingToken);
   const blue=await apply([['vendor','Fixture'],['price','0:1000']]);assert.equal(blue.totalCount,40);
   const noColor=await apply([['option-Color','Blue',false]]);assert.equal(noColor.totalCount,60);
   const red=await apply([['option-Color','Red']]);assert.equal(red.totalCount,20);
   const removed=await apply([['option-Size','M',false]]);assert.equal(removed.totalCount,20);assert.deepEqual(removed.products.map(p=>p.id),red.products.map(p=>p.id));
   assert.equal(await page.locator('.cfp-order-error,.cfp-facet-error').count(),0);assert.deepEqual(errors,[]);
   proof.cases.push({width,fourFilters:40,changedColor:20,removedSize:20,newRankingBuilds:fixture.state.builds-builds,currentOrderUnavailable:true,retainsVisibleCards:true,reusesCardTokenBeforeFacets:true,externalRequestsAllowed:0});console.log('PASS '+JSON.stringify(proof.cases.at(-1)));
  }finally{await context.close();}
 }
 await fs.writeFile('scratch/prepared-membership-browser-proof-20261124.json',JSON.stringify(proof,null,2));
}finally{await browser.close();fixture.dispose();}
