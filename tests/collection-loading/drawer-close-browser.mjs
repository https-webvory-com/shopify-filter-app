import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [width,reducedMotion,desktopFilterLayout] of [[1440,'no-preference','drawer'],[390,'no-preference','drawer'],[390,'reduce','drawer'],[390,'no-preference','vertical']]){
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,delay:1,priceDelay:0,imageDelay:0,hold:false,productCount:30,realToolbar:true,filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}}],globalSettings:{desktopFilterLayout,showFilterOptionsWithOneItem:true}})});
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/collections/fixture');await page.locator('#cfp-sidebar .cfp-group').first().waitFor({state:'attached'});
  const open=async()=>{await page.locator('#cfp-drawer-trigger-btn').evaluate(el=>el.click());await page.locator('#cfp-sidebar').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));};
  await open();
  const closing=await page.locator('#cfp-close-btn').evaluate(el=>{
   el.click();const drawer=document.getElementById('cfp-sidebar'),overlay=document.getElementById('cfp-overlay'),animations=drawer.getAnimations(),animation=animations.find(animation=>!animation.animationName);
   const result={duration:animation?.effect.getTiming().duration,display:getComputedStyle(drawer).display,closing:drawer.classList.contains('cfp-sidebar--closing'),inert:drawer.inert,expanded:document.getElementById('cfp-drawer-trigger-btn').getAttribute('aria-expanded'),locked:document.body.style.overflow};
   if(animation){const all=[animation,...overlay.getAnimations()];all.forEach(animation=>{animation.pause();animation.currentTime=100;});result.middle=drawer.getBoundingClientRect().left;result.width=drawer.getBoundingClientRect().width;result.opacity=Number(getComputedStyle(overlay).opacity);all.forEach(animation=>{animation.currentTime=0;animation.play();});}
   return result;
  });
  if(reducedMotion==='reduce')assert.equal(closing.closing,false);
  else{assert.equal(closing.duration,320);assert.equal(closing.display,'flex');assert.ok(closing.closing&&closing.inert);assert.equal(closing.expanded,'false');assert.equal(closing.locked,'hidden');assert.ok(closing.middle<0&&closing.middle>-closing.width,JSON.stringify(closing));assert.ok(closing.opacity>0&&closing.opacity<1,JSON.stringify(closing));}
  await page.waitForTimeout(450);assert.equal(await page.locator('#cfp-sidebar').isVisible(),false,JSON.stringify(await page.locator('#cfp-sidebar').evaluate(el=>({classes:el.className,display:getComputedStyle(el).display,inert:el.inert,overflow:document.body.style.overflow,animations:el.getAnimations().map(a=>({state:a.playState,time:a.currentTime,duration:a.effect.getTiming().duration}))}))));assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  await open();await page.locator('#cfp-close-btn').evaluate(el=>el.click());await page.waitForTimeout(70);await page.locator('#cfp-drawer-trigger-btn').evaluate(el=>el.click());await page.waitForTimeout(450);
  assert.equal(await page.locator('#cfp-sidebar').evaluate(el=>el.classList.contains('cfp-sidebar--open')&&!el.classList.contains('cfp-sidebar--closing')&&!el.inert),true,'old close completion cannot hide a reopened drawer');
  await page.keyboard.press('Escape');await page.waitForTimeout(450);assert.equal(await page.locator('#cfp-sidebar').isVisible(),false);
  if(desktopFilterLayout==='vertical'){
   await open();await page.locator('#cfp-close-btn').evaluate(el=>el.click());await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(650);
   assert.equal(await page.locator('#cfp-sidebar').evaluate(el=>!el.inert&&!el.classList.contains('cfp-sidebar--closing')&&el.getAttribute('aria-hidden')==='false'),true,'resize restores interactive inline filters');assert.equal(await page.locator('#cfp-sidebar').isVisible(),true);
  }
  assert.deepEqual(errors,[]);console.log('PASS drawer close '+width+' '+reducedMotion+' '+desktopFilterLayout+': 320ms slide/fade, scroll/focus cleanup, rapid reopening, Escape and responsive layout');await page.close();
 }
}finally{await browser.close();fixture.dispose();}
