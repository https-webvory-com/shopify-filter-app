import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createEditorFixture} from './editor-fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const legacy={id:'gid://shopify/Product/1',title:'Alpha Snowboard',image:'',available:true};
const fixture=await createEditorFixture({legacyPins:[legacy]}),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(fixture.origin+'/app/search/pinning');await page.getByRole('region',{name:'Existing empty search pin'}).waitFor();assert.equal(fixture.state.saves,0);
  const create=page.getByRole('button',{name:'Create pin',exact:true});
  if(await create.count()){await create.click();await page.getByText('Create a New Pin',{exact:true}).click();}else await page.getByRole('button',{name:'Add your pins',exact:true}).click();
  assert.equal(await page.locator('#create-pin-term').inputValue(),'');assert.ok((await page.getByRole('note').innerText()).includes('only in Full screen search UI'));assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'Continue',exact:true}).click();
  const editor=page.getByRole('region',{name:'Empty search query pinning',exact:true}),selection=page.getByRole('region',{name:'Pinned products for empty search',exact:true});await editor.waitFor();assert.equal(await page.getByRole('textbox',{name:'Pin name',exact:true}).inputValue(),'Empty search pin');assert.deepEqual(await selection.locator('.esp-name').allTextContents(),['Alpha Snowboard']);
  await editor.getByRole('textbox',{name:'Search term',exact:true}).fill('blue');await page.locator('#search-pin-term').waitFor();await page.locator('#search-pin-term').fill('');await editor.waitFor();
  await selection.getByRole('button',{name:'Choose products',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Choose products',exact:true});await dialog.getByRole('button',{name:'Pin product',exact:true}).first().click();await dialog.getByRole('button',{name:'Pin product',exact:true}).click();await dialog.getByRole('button',{name:'Done',exact:true}).click();
  await selection.getByRole('button',{name:'Move Gamma Snowboard up',exact:true}).click();await selection.getByRole('button',{name:'Move Gamma Snowboard up',exact:true}).click();assert.ok((await selection.innerText()).includes('1 selected product is currently hidden'));
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForURL('**/app/search/pinning');await page.getByText('Empty search pin',{exact:true}).first().waitFor();
  assert.deepEqual(fixture.state.rules[0].searchQueries,['']);assert.deepEqual(fixture.state.rules[0].products.map(p=>p.id),['3','1','2'].map(id=>'gid://shopify/Product/'+id));assert.deepEqual(fixture.state.settings.emptySearchProducts,[]);
  await page.getByText('Empty search pin',{exact:true}).first().click();await editor.waitFor();assert.deepEqual(await selection.locator('.esp-name').allTextContents(),['Gamma Snowboard','Alpha Snowboard','Beta Snowboard']);
  await selection.getByRole('button',{name:'Remove Beta Snowboard',exact:true}).click();await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForURL('**/app/search/pinning');assert.equal(fixture.state.rules[0].products.length,2);
  await page.goto(fixture.origin+'/app/search/settings');assert.equal(await page.getByRole('region',{name:'Pinned products for empty search'}).count(),0);assert.equal(await page.getByRole('button',{name:'Open Search Pinning',exact:true}).count(),0);assert.equal(await page.locator('input[name="popularProductLimit"]').count(),0);
  await page.getByRole('button',{name:/Compact UI A small panel/}).click();assert.equal(await page.getByRole('button',{name:'Open Search Pinning',exact:true}).count(),0);assert.equal(await page.getByRole('region',{name:'Full screen UI settings',exact:true}).count(),0);
  await page.getByRole('button',{name:/Full screen UI Your original/}).click();assert.equal(await page.getByRole('region',{name:'Pinned products for empty search'}).count(),0);await page.goto(fixture.origin+'/app/search/pinning');
  await page.getByText('Empty search pin',{exact:true}).first().click();await editor.waitFor();await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await selection.getByRole('button',{name:'Choose products',exact:true}).click();await dialog.waitFor();assert.ok(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth));await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);await editor.screenshot({path:'scratch/native-empty-pins-mobile.png'});
  assert.deepEqual(errors,[]);console.log('PASS native empty-search pin UI: blank create/Continue, legacy selection retained, keyword/blank switch, product picker/order/stock, Save normal rule/list/edit/reload, moved settings link, Full-only navigation, mobile/Escape/no errors');
}finally{await browser.close();await fixture.close();}
