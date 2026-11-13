import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href),{origin}=JSON.parse(await fs.readFile('scratch/pinning-fixture.json','utf8'));
assert.equal(new URL(origin).hostname,'127.0.0.1');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage(),errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(new URL(request.url()).pathname==='/app/product-picker'&&request.method()==='POST')requests.push(Object.fromEntries(new URLSearchParams(request.postData())));});
 await page.goto(origin+'/admin-ui');await page.waitForFunction(()=>document.querySelectorAll('.product-search-card').length===9);
 await page.locator('.product-search-card').first().hover();await page.getByTitle('Pin this product',{exact:true}).first().click();await page.getByTitle('Remove pin',{exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll('.product-search-card').length===9);
 const input=page.getByRole('combobox',{name:'Search products by Title'});
 const control=values=>fetch(origin+'/__control',{method:'POST',body:JSON.stringify(values)});
 await control({pickerFailures:1});await input.fill('Green');await page.getByText('Could not load products. Please retry.',{exact:true}).waitFor();
 assert.equal(await page.getByTitle('Remove pin',{exact:true}).count(),1,'504 preserves the unsaved pin');assert.equal(await page.getByRole('heading',{name:'Application Error'}).count(),0);
 await page.getByRole('button',{name:'Search',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.product-search-card').length===9);
 assert.equal(requests.at(-1).targetQueries,'["green dresses"]','manual Search retains the rule query');
 await page.getByRole('button',{name:'Next',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.product-search-card').length===2);
 assert.equal(requests.at(-1).skip,'9');
 await control({pickerDelay:20000});await input.fill('Green Dress');await page.getByText('Could not load products. Please retry.',{exact:true}).waitFor({timeout:18000});
 assert.equal(await page.getByTitle('Remove pin',{exact:true}).count(),1,'timeout preserves unsaved selection');
 await control({pickerDelay:0});await page.getByRole('button',{name:'Search',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.product-search-card').length===9);
 assert.deepEqual(errors,[]);assert.deepEqual((await(await fetch(origin+'/state')).json()).products,[],'no rule saved during picker verification');
 console.log('PASS product picker: first page, Search retains target, nine-card pagination, 504/15s timeout stay inside editor, retry succeeds, unsaved pin preserved');
}finally{await browser.close();}
