import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const cli=(await fs.readFile('scratch/rea-evaluation/cli-path.txt','utf8')).trim();
const {chromium}=await import(pathToFileURL(path.resolve(path.dirname(cli),'../../playwright-core/index.mjs')).href);
const fixture=await createLoadingServer();
await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  for(const width of [390,1440]) for(const route of ['/collections/fixture','/search?q=blue%20prom%20dress']) for(const isWholesale of [true,false]) for(const loggedIn of [false,true]) {
    const productVariants=Object.fromEntries(Array.from({length:30},(_,i)=>[String(i+1),[{id:String((i+1)*100),sku:'KOS-'+(10000+i+1)+'-Blue-6',available:true,price:100,option1:'Blue',imageUrl:'/image/'+(i+1)+'.svg'}]]));
    await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,delay:1,priceDelay:0,imageDelay:0,globalSettings:{isWholesale},productVariants})});
    const page=await browser.newPage({viewport:{width,height:1000}});
    await page.addInitScript(value=>{window.cfpCustomerLoggedIn=value;},loggedIn);
    await page.goto(origin+route);
    const card=page.locator('.cfp-product-card[data-cfp-product-id]').first();
    await card.waitFor();
    await page.waitForFunction(()=>!document.querySelector('.cfp-product-card--preview'));
    const productId=(await card.getAttribute('data-cfp-product-id')).split('/').pop();
    const identity=await card.locator('.cfp-product-card__title').textContent();
    assert.equal(identity,isWholesale?String(10000+Number(productId)).slice(0,4):'Fixture dress '+productId);
    assert.equal(await card.locator('.cfp-product-card__sku').count(),isWholesale?1:0);
    assert.equal(await card.locator('.cfp-product-card__price-row').count(),isWholesale&&!loggedIn?0:1);
    const spacing=await card.locator('.cfp-product-card__title').evaluate(el=>({height:el.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(el).lineHeight),swatchMargin:getComputedStyle(el.parentElement.querySelector('.cfp-product-swatches')).marginTop}));
    if(isWholesale){assert.ok(spacing.height<=spacing.lineHeight+1);assert.equal(spacing.swatchMargin,'6px');}
    else assert.ok(Math.abs(spacing.height-2*spacing.lineHeight)<1);
    console.log('PASS '+width+' '+route+' wholesale='+isWholesale+' loggedIn='+loggedIn+': correct identity, price visibility and SKU spacing');
    await page.close();
  }
} finally {await browser.close();fixture.dispose();}
