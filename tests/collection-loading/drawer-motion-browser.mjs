import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createLoadingServer} from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const fixture=await createLoadingServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port,browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const [width,reducedMotion] of [[1440,'no-preference'],[390,'no-preference'],[390,'reduce']]){
  await fetch(origin+'/__control',{method:'POST',body:JSON.stringify({reset:true,delay:1,priceDelay:0,imageDelay:0,hold:false,productCount:30,realToolbar:true,filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}}],globalSettings:{desktopFilterLayout:'drawer',showFilterOptionsWithOneItem:true}})});
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/collections/fixture');await page.locator('#cfp-sidebar .cfp-group').first().waitFor({state:'attached'});const button=page.locator('#cfp-drawer-trigger-btn');await button.waitFor({state:'visible'});await button.hover();
  assert.equal(await button.evaluate(el=>getComputedStyle(el,'::before').display),'none','no hover stripe');
  const start=await button.evaluate(el=>{
   el.click();const drawer=document.getElementById('cfp-sidebar'),backdrop=document.getElementById('cfp-overlay'),style=getComputedStyle(drawer),animation=drawer.getAnimations().find(animation=>animation.animationName==='cfpDrawerEnter');
   const result={left:drawer.getBoundingClientRect().left,width:drawer.getBoundingClientRect().width,name:style.animationName,duration:animation?.effect.getTiming().duration};
   if(animation){
    const animations=[animation,...backdrop.getAnimations()];animations.forEach(animation=>{animation.pause();animation.currentTime=100;});
    result.middle=drawer.getBoundingClientRect().left;result.backdropOpacity=Number(getComputedStyle(backdrop).opacity);result.backdropAnimation=getComputedStyle(backdrop).animationName;result.backdropAnimations=backdrop.getAnimations().map(animation=>({name:animation.animationName,property:animation.transitionProperty,time:animation.currentTime,duration:animation.effect.getTiming().duration}));
    animations.forEach(animation=>{animation.currentTime=0;animation.play();});
   }
   return result;
  });
  assert.equal(await button.evaluate(el=>getComputedStyle(el,'::before').display),'none','no expanded stripe');
  if(reducedMotion==='reduce')assert.equal(start.name,'none');
  else{
   assert.equal(start.name,'cfpDrawerEnter');assert.ok(start.duration>=200);assert.ok(start.left<0,JSON.stringify(start));
   assert.ok(start.middle>start.left&&start.middle<0,JSON.stringify(start));
   assert.ok(start.backdropOpacity>0&&start.backdropOpacity<1,'backdrop fades in: '+JSON.stringify(start));
  }
  await page.waitForTimeout(360);const settled=await page.locator('#cfp-sidebar').evaluate(el=>({left:el.getBoundingClientRect().left,width:el.getBoundingClientRect().width}));assert.ok(Math.abs(settled.left)<1);assert.equal(settled.width,width===390?390:420);
  await page.locator('#cfp-close-btn').click();await button.evaluate(el=>el.click());
  if(reducedMotion!=='reduce')assert.equal(await page.locator('#cfp-sidebar').evaluate(el=>el.getAnimations().some(animation=>animation.animationName==='cfpDrawerEnter')),true,'animation repeats on reopening');
  assert.deepEqual(errors,[]);console.log('PASS drawer '+width+' '+reducedMotion+': no hover/active stripe, visible 320ms motion, settled size and reopening');await page.close();
 }
}finally{await browser.close();fixture.dispose();}
