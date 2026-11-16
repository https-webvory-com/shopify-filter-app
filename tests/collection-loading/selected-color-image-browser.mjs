import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const fixture=await createLoadingServer();
await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const available of [false,true]){
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,productCount:25,delay:0,imageDelay:0,priceDelay:0,precompute:true,noPins:true,noMerchandising:true,marketPriceReady:true,globalSettings:{showOnlyInStock:true,hideUnavailableVariantsWhenSelected:false,secondImageOnHover:true},productFields:{'1':{images:['/image/blue.svg','/image/blue-back.svg','/image/burgundy.svg']}},productVariants:{'1':[{id:'101',price:20,available,option1:'Burgundy',imageUrl:'/image/burgundy.svg'},{id:'102',price:20,available:true,option1:'Dusty Blue',imageUrl:'/image/blue.svg'}]}})});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/collections/fixture?option_Color=Burgundy');
  const card=page.locator('.cfp-product-card').filter({has:page.locator('a.cfp-product-card__link[href^="/products/dress-1?"]')});
  await card.waitFor();await page.waitForFunction(()=>document.querySelector('a.cfp-product-card__link[href^="/products/dress-1?"]')?.closest('.cfp-product-card')?._cfpMarketProduct);
  const state=await card.evaluate(c=>({primary:c.querySelector('.cfp-product-card__image--primary').getAttribute('src'),secondary:c.querySelector('.cfp-product-card__image--secondary')?.getAttribute('src'),links:[...c.querySelectorAll('.cfp-product-card__link')].map(a=>a.getAttribute('href')),colors:[...c.querySelectorAll('.cfp-swatch-item')].map(x=>x.dataset.cfpColor),active:c.querySelector('.cfp-swatch-active')?.dataset.cfpColor}));
  assert.ok(state.primary.includes('/image/burgundy.svg'));assert.ok(state.links.every(x=>x.endsWith('variant=101')));
  if(!available){assert.ok(state.secondary.includes('/image/burgundy.svg'));assert.deepEqual(state.colors,['Dusty Blue']);assert.equal(state.active,undefined);}else assert.equal(state.active,'Burgundy');
  await card.locator('.cfp-swatch-item[data-cfp-color="Dusty Blue"]').click();
  assert.ok((await card.locator('.cfp-product-card__image--primary').getAttribute('src')).includes('/image/blue.svg'));
  assert.ok((await card.locator('.cfp-product-card__link').first().getAttribute('href')).endsWith('variant=102'));
  assert.deepEqual(errors,[]);console.log('PASS selected Burgundy '+(available?'available':'sold-out')+': matching image/link, honest swatch, manual color selection');
  await page.close();
 }
}finally{await browser.close();fixture.dispose();}
