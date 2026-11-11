import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createLoadingServer} from './server.mjs';
import {createRedisTestLayer} from './redis-layer.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const redisLayer=process.argv.includes('--real-redis')?await createRedisTestLayer():null;
let fixture;
try{fixture=await createLoadingServer({redisLayer});}catch(error){await redisLayer?.close();throw error;}
await new Promise((resolve,reject)=>{fixture.server.once('error',reject);fixture.server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+fixture.server.address().port;
const profile=path.resolve('scratch',`collection-headless-${process.pid}`);
await fs.mkdir(profile,{recursive:true});
const chrome=spawn(process.env.HEADLESS_CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync',
  '--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank',
],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr='';chrome.stderr.on('data',chunk=>stderr+=chunk.toString());
const results=[];let socket;
// Track the intentional facet follow-up separately from product delivery/polling.
const phases=data=>({...data,allRequests:data.requests,facetResponses:data.requests.filter(r=>['collection-v1','collection-facets-v1'].includes(r.profile)&&r.page==='1'&&r.token),requests:data.requests.filter(r=>!(['collection-v1','collection-facets-v1'].includes(r.profile)&&r.page==='1'&&r.token))});
const getState=async()=>phases(await(await fetch(origin+'/__state')).json());
let beforeReset=async()=>{};
const control=async values=>{if(values.reset)await beforeReset();const response=await fetch(origin+'/__control',{method:'POST',body:JSON.stringify(values)});const body=await response.json();if(!response.ok)throw Error(body.error||'Fixture control failed');return phases(body);};
try{
  let endpoint;
  for(let i=0;i<100;i++){endpoint=stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];if(endpoint)break;if(chrome.exitCode!==null)throw Error('Headless Chrome exited before connecting');await delay(100);}
  if(!endpoint)throw Error('Headless Chrome startup timeout');
  const targetPort=new URL(endpoint).port;
  const targets=await(await fetch('http://127.0.0.1:'+targetPort+'/json')).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await Promise.race([new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});socket.addEventListener('close',()=>reject(Error('Headless connection closed during startup')),{once:true});}),delay(10000).then(()=>{throw Error('Headless connection timeout');})]);
  let next=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(!message.id)return;const promise=pending.get(message.id);pending.delete(message.id);clearTimeout(promise?.timer);message.error?promise?.reject(Error(message.error.message)):promise?.resolve(message.result);});
  socket.addEventListener('close',()=>{for(const promise of pending.values()){clearTimeout(promise.timer);promise.reject(Error('Headless browser disconnected'));}pending.clear();});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out: '+method));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);return response.result.value;};
  const wait=async(expression,timeout=20000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+expression);};
  const cards=()=>evaluate(`[...document.querySelectorAll('.cfp-product-card--reveal')].map(c=>c.querySelector('a').getAttribute('href').match(/dress-(\\d+)/)[1])`);
  const navigate=async(query='')=>{await send('Page.navigate',{url:origin+'/collections/fixture'+query});await wait('window._cfpInitStarted===true');};
  let selected=!process.argv.some(a=>a.startsWith('--from='));
  const test=async(name,fn)=>{const only=process.argv.find(a=>a.startsWith('--match='));if(only&&!name.includes(only.slice(8)))return;if(!selected){selected=name.startsWith(process.argv.find(a=>a.startsWith('--from=')).slice(7));if(!selected)return;}if(process.argv.includes('--performance-only')&&!name.startsWith('early first-page')&&!name.startsWith('new visitor after'))return;try{const detail=await fn();results.push({name,passed:true,detail});console.log('PASS '+name+(detail?.baselineCardsMs?': '+JSON.stringify(detail):''));}catch(error){results.push({name,passed:false,error:error.message});console.log('FAIL '+name+': '+error.message);throw error;}};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  beforeReset=async()=>{await send('Page.navigate',{url:'about:blank'});await delay(100);};
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  const version=await send('Browser.getVersion');
  await test('filter drawer escapes transformed and clipped theme sections at desktop and mobile widths',async()=>{
    const {identifier}=await send('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('DOMContentLoaded',()=>{const app=document.querySelector('.cfp-v1-app-container');const section=document.createElement('section');section.id='theme-clipped-section';section.style.cssText='transform:translateZ(0);overflow:hidden;contain:paint;margin-top:140px;height:320px;position:relative;z-index:0';app.before(section);section.append(app);},{once:true});`});
    try{
      await control({reset:true,realToolbar:true,productCount:30,precompute:true,filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}}],globalSettings:{desktopFilterLayout:'drawer',showFilterOptionsWithOneItem:true},apiDelay:0,imageDelay:0,priceDelay:0});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      for(const width of [1440,900,390]){
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<769});await delay(350);
        await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");await delay(350);
        const geometry=await evaluate(`(()=>{const s=document.querySelector('#cfp-sidebar'),r=s.getBoundingClientRect(),f=s.querySelector('.cfp-sidebar__footer').getBoundingClientRect();return {top:r.top,left:r.left,bottom:r.bottom,right:r.right,footerBottom:f.bottom,parent:s.parentElement.tagName,overlayParent:document.querySelector('#cfp-overlay').parentElement.tagName,hit:s.contains(document.elementFromPoint(30,110))};})()`);
        assert.equal(geometry.top,0,JSON.stringify(geometry));assert.equal(geometry.left,0);assert.ok(geometry.bottom<=900&&geometry.right<=width);assert.ok(geometry.footerBottom<=900);assert.equal(geometry.parent,'BODY');assert.equal(geometry.overlayParent,'BODY');assert.equal(geometry.hit,true);
        await evaluate("document.querySelector('#cfp-apply-btn').click()");assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open')"),false);
      }
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }finally{await send('Page.removeScriptToEvaluateOnNewDocument',{identifier});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});}
  });
  await test('filter width editor applies valid drafts, resets each style and preserves saved widths on reopen',async()=>{
    await send('Page.navigate',{url:origin+'/filter-width-admin'});
    await wait("!!document.querySelector('input[aria-label=\"Drawer width (px)\"]')");
    assert.equal(await evaluate("document.body.innerText.includes('Horizontal toolbar width')"),false);
    await evaluate("document.querySelector('[aria-label=\"Drawer width presets\"] button:last-child').click()");
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Drawer width (px)\"]').value"),'520');
    assert.deepEqual(await evaluate('savedWidths'),[],'presets must remain drafts until Apply');
    const fill=async(label,value)=>evaluate(`(()=>{const input=document.querySelector('input[aria-label="'+${JSON.stringify(label)}+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await fill('Drawer width slider','560');
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Drawer width (px)\"]').value"),'560');
    await fill('Drawer width (px)','300');
    assert.deepEqual(await evaluate('savedWidths'),[]);
    await evaluate("document.querySelector('[aria-label=\"Apply drawer width\"]').click()");
    assert.deepEqual(await evaluate('savedWidths'),[{key:'drawerWidth',value:300}]);
    await fill('Vertical sidebar width (px)','601');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Apply vertical sidebar width\"]').disabled"),true);
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Vertical sidebar width (px)\"]').getAttribute('aria-invalid')"),'true');
    await fill('Vertical sidebar width (px)','');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"Apply vertical sidebar width\"]').disabled"),true);
    await fill('Vertical sidebar width (px)','520');
    await evaluate("document.querySelector('[aria-label=\"Apply vertical sidebar width\"]').click()");
    await send('Page.reload');await wait("document.querySelector('input[aria-label=\"Drawer width (px)\"]')?.value==='300'");
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Vertical sidebar width (px)\"]').value"),'520');
    await evaluate("document.querySelector('[aria-label=\"Reset drawer width\"]').click()");
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Vertical sidebar width (px)\"]').value"),'520');
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Drawer width (px)\"]').value"),'420');
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});await delay(200);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  });
  await test('per-style filter widths apply independently and horizontal filters retain full width',async()=>{
    const filterSettings=[{id:'width-vendor',isEnabled:true,filterType:'vendor',label:'Brand',displayMode:'List',config:{}}];
    for(const desktopFilterLayout of ['drawer','vertical','horizontal']){
      await control({reset:true,realToolbar:true,productCount:30,precompute:true,filterSettings,globalSettings:{desktopFilterLayout,drawerWidth:300,verticalFilterWidth:520,showFilterOptionsWithOneItem:true},apiDelay:0,imageDelay:0,priceDelay:0});
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await navigate();
      await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      const products=await cards();assert.equal(products.length,25);
      if(desktopFilterLayout==='drawer'){
        await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");
        assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().width"),300);
        await evaluate("document.querySelector('#cfp-apply-btn').click()");
      }else if(desktopFilterLayout==='vertical')assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().width"),520);
      else {
        const sizes=await evaluate("(()=>{const wrapper=document.querySelector('.cfp-layout-wrapper'),style=getComputedStyle(wrapper);return {toolbar:document.querySelector('#cfp-top-bar').getBoundingClientRect().width,available:wrapper.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),viewport:innerWidth};})()");
        assert.ok(Math.abs(sizes.toolbar-sizes.available)<2,'Horizontal full-width sizing: '+JSON.stringify(sizes));
      }
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(350);
      await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().width"),300);
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar').parentElement.tagName"),'BODY');
      await evaluate("document.querySelector('#cfp-apply-btn').click()");
      assert.deepEqual(await cards(),products);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Mobile overflow after '+desktopFilterLayout+': '+JSON.stringify(await evaluate('({scroll:document.documentElement.scrollWidth,viewport:innerWidth})')));
    }
    await control({reset:true,realToolbar:true,productCount:30,precompute:true,filterSettings,globalSettings:{desktopFilterLayout:'vertical',integrations:{drawerWidth:600,verticalFilterWidth:600},showFilterOptionsWithOneItem:true},apiDelay:0,imageDelay:0,priceDelay:0});
    await send('Emulation.setDeviceMetricsOverride',{width:900,height:900,deviceScaleFactor:1,mobile:false});await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    const verticalSizing=await evaluate("(()=>{const wrapper=document.querySelector('.cfp-layout-wrapper'),style=getComputedStyle(wrapper);return {width:document.querySelector('#cfp-sidebar').getBoundingClientRect().width,available:wrapper.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)};})()");
    assert.ok(Math.abs(verticalSizing.width-Math.min(600,verticalSizing.available-284))<1,JSON.stringify(verticalSizing));
    await send('Emulation.setDeviceMetricsOverride',{width:769,height:900,deviceScaleFactor:1,mobile:false});await delay(350);
    assert.ok(await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().width<=document.querySelector('.cfp-layout-wrapper').getBoundingClientRect().width-260"));
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(350);await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");
    assert.ok(await evaluate("Math.abs(document.querySelector('#cfp-sidebar').getBoundingClientRect().width-innerWidth*.9)<1"));
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);assert.deepEqual(await evaluate('browserErrors'),[]);
    await evaluate("document.querySelector('#cfp-apply-btn').click()");
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  });
  await test('vertical reference UI keeps saved widths and uses compact accessible controls',async()=>{
    const filterSettings=[
      {id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'Swatch',config:{multipleSelection:true,swatchConfig:{showLabel:true}}},
      {id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',displayMode:'Box',config:{multipleSelection:true,advanced:{showMoreType:'View more'}}},
      {id:'vendor',isEnabled:true,filterType:'vendor',label:'Designers',displayMode:'List',config:{multipleSelection:true,advanced:{desktopCollapsed:true}}}];
    const productFields=Object.fromEntries(Array.from({length:30},(_,i)=>[String(i+1),{options:[{name:'Color',values:['Blue','Red','White']},{name:'Size',values:['XS','S','M','L','XL','2XL','3XL','4XL']}]}]));
    await control({reset:true,realToolbar:true,productCount:30,noPins:true,noMerchandising:true,precompute:true,filterSettings,productFields,
      globalSettings:{desktopFilterLayout:'vertical',verticalFilterWidth:333,sizeOptionsPerRow:4,showProductCount:false,showFilterOptionsWithOneItem:true},apiDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    const styles=await evaluate(`(()=>{const s=document.querySelector('#cfp-sidebar'),group=s.querySelector('.cfp-group__toggle'),chip=s.querySelector('.cfp-button-chip > span'),swatch=s.querySelector('.cfp-swatch-circle'),grid=s.querySelector('.cfp-color-grid--colors');return {width:s.getBoundingClientRect().width,title:getComputedStyle(group).textTransform,font:getComputedStyle(group).fontSize,weight:getComputedStyle(group).fontWeight,chipHeight:chip.getBoundingClientRect().height,chipRadius:getComputedStyle(chip).borderRadius,swatchWidth:swatch.getBoundingClientRect().width,colorColumns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,summary:getComputedStyle(s.querySelector('.cfp-vertical-summary')).display,count:s.querySelector('.cfp-vertical-result-count').textContent,header:getComputedStyle(s.querySelector('.cfp-sidebar__header')).position,bodyOverflow:getComputedStyle(s.querySelector('.cfp-sidebar__body')).overflowY,printedCounts:s.querySelectorAll('.cfp-checkbox__count').length};})()`);
    const optionStyles=()=>evaluate("(()=>{const s=document.querySelector('#cfp-sidebar'),p=getComputedStyle(s),body=getComputedStyle(s.querySelector('.cfp-sidebar__body'));return {chip:getComputedStyle(s.querySelector('.cfp-button-chip > span')).fontSize,swatch:getComputedStyle(s.querySelector('.cfp-swatch-label')).fontSize,label:getComputedStyle(s.querySelector('.cfp-checkbox__label')).fontSize,separator:getComputedStyle(s.querySelectorAll('.cfp-group')[1]).borderTopWidth,firstSeparator:getComputedStyle(s.querySelector('.cfp-group')).borderTopWidth,left:p.paddingLeft,right:p.paddingRight,bottom:p.paddingBottom,bodyLeft:body.paddingLeft,bodyRight:body.paddingRight,bodyBottom:body.paddingBottom};})()");
    const desktopOptions=await optionStyles();
    assert.equal(desktopOptions.chip,'12px');assert.equal(desktopOptions.swatch,'12px');assert.equal(desktopOptions.label,'12px');assert.equal(desktopOptions.separator,'1px');assert.equal(desktopOptions.firstSeparator,'0px');
    assert.equal(desktopOptions.left,'16px');assert.equal(desktopOptions.right,desktopOptions.left);assert.equal(desktopOptions.bottom,desktopOptions.left);
    assert.equal(styles.width,333);assert.equal(styles.title,'none');assert.equal(styles.font,'14px');assert.equal(styles.weight,'600');
    assert.equal(styles.chipHeight,32);assert.equal(styles.chipRadius,'4px');assert.equal(styles.swatchWidth,20);assert.equal(styles.colorColumns,2);
    assert.equal(styles.summary,'block');assert.equal(styles.count,'30 products');assert.equal(styles.header,'static');assert.equal(styles.bodyOverflow,'visible');assert.equal(styles.printedCounts,0);
    assert.equal(await evaluate("document.querySelector('#cfp-group-vendor-vendor-').classList.contains('cfp-collapsed')"),true);
    await evaluate("document.querySelector('#cfp-group-vendor-vendor-').previousElementSibling.click()");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-group-vendor-vendor-').previousElementSibling.querySelector('.cfp-vertical-toggle-icon'),'::after').display"),'none');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar .cfp-size-grid .cfp-view-more-hidden')).display"),'none');
    await evaluate("document.querySelector('#cfp-group-size-option-Size .cfp-view-more-btn').click()");
    assert.equal(await evaluate("[...document.querySelectorAll('#cfp-group-size-option-Size .cfp-button-chip')].every(e=>e.getBoundingClientRect().height>0)"),true);
    for(const width of [240,520,600]){
      await evaluate("document.querySelector('#cfp-sidebar').style.setProperty('--cfp-vertical-width','"+width+"px');document.querySelector('.cfp-layout-wrapper').style.setProperty('--cfp-vertical-width','"+width+"px')");
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().width"),width);
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
    }
    await evaluate("document.querySelector('#cfp-sidebar').style.setProperty('--cfp-vertical-width','333px');document.querySelector('.cfp-layout-wrapper').style.setProperty('--cfp-vertical-width','333px')");
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(350);
    await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");
    const mobileOptions=await optionStyles();assert.equal(mobileOptions.chip,'10px');assert.equal(mobileOptions.swatch,'10px');assert.equal(mobileOptions.label,'10px');assert.equal(mobileOptions.separator,'1px');
    assert.equal(mobileOptions.bodyLeft,'16px');assert.equal(mobileOptions.bodyRight,mobileOptions.bodyLeft);assert.equal(mobileOptions.bodyBottom,mobileOptions.bodyLeft);
    await evaluate("document.querySelector('#cfp-apply-btn').click()");
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await delay(350);
    await fs.writeFile('scratch/vertical-reference-fixture.png',Buffer.from(await send('Page.captureScreenshot',{format:'png'}).then(r=>r.data),'base64'));
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('vertical selected filters keep one Clear all that resets options and price bands',async()=>{
    const filterSettings=[{id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',config:{multipleSelection:true}},
      {id:'price',isEnabled:true,filterType:'price',label:'Price',config:{priceRanges:[{from:0,to:100,label:'Under {1}'}]}}];
    await control({reset:true,productCount:30,noPins:true,noMerchandising:true,precompute:true,filterSettings,
      productFields:Object.fromEntries(Array.from({length:30},(_,i)=>[String(i+1),{options:[{name:'Size',values:['S','M']}]}])),
      globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true},apiDelay:0,priceDelay:0,imageDelay:0});
    await navigate('?option_Size=S&price[]=0:100');await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    assert.equal(await evaluate("document.querySelector('.cfp-vertical-clear')"),null);
    assert.equal(await evaluate("[...document.querySelectorAll('button')].filter(b=>/^Clear all/.test(b.textContent.trim())&&b.getBoundingClientRect().width>0).length"),1);
    assert.equal(await evaluate("document.querySelector('.cfp-breadcrumb-clear').getBoundingClientRect().width>0"),true);
    const before=(await getState()).requests.length;
    await evaluate("document.querySelector('.cfp-breadcrumb-clear').click()");
    await wait("!document.querySelector('#cfp-sidebar.cfp-loading')&&!new URLSearchParams(location.search).has('option_Size')");
    await wait("!document.querySelector('.cfp-breadcrumb-clear')");
    assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar input:checked').length"),0);
    assert.equal(await evaluate("document.querySelectorAll('.cfp-vertical-summary').length"),1);
    assert.equal((await getState()).requests.length-before,1);
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('vertical reference styles leave horizontal, drawer and mobile presentation unchanged',async()=>{
    const filterSettings=[{id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',config:{multipleSelection:true}}];
    for(const layout of ['horizontal','drawer','vertical']){
      await control({reset:true,realToolbar:true,productCount:30,noPins:true,noMerchandising:true,precompute:true,filterSettings,
        productFields:Object.fromEntries(Array.from({length:30},(_,i)=>[String(i+1),{options:[{name:'Size',values:['S','M']}]}])),
        globalSettings:{desktopFilterLayout:layout,drawerWidth:300,showFilterOptionsWithOneItem:true},apiDelay:0,priceDelay:0,imageDelay:0});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      assert.equal(await evaluate("document.body.classList.contains('cfp-vertical-style')"),layout==='vertical');
      if(layout!=='vertical')assert.equal(await evaluate("getComputedStyle(document.querySelector('.cfp-vertical-summary')).display"),'none');
      if(layout==='drawer'){
        await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");
        assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().width"),300);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar .cfp-group__toggle')).textTransform"),'uppercase');
      }
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(350);
      await evaluate("if(!document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open'))document.querySelector('#cfp-drawer-trigger-btn').click()");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.cfp-vertical-summary')).display"),'none');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar .cfp-vertical-toggle-icon')).display"),'none');
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().width"),300);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar .cfp-group__toggle')).textTransform"),'uppercase');
      assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
      assert.deepEqual(await evaluate('browserErrors'),[]);
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    }
  });
  await test('vertical refinement starts the sidebar at the sorting row and restores placement on mobile',async()=>{
    const settings=[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'Swatch',config:{multipleSelection:true,advanced:{desktopSearchBox:true,mobileSearchBox:true}}}];
    await control({reset:true,themeIntro:true,realToolbar:true,productCount:30,noPins:true,noMerchandising:true,precompute:true,filterSettings:settings,
      globalSettings:{desktopFilterLayout:'vertical',verticalFilterWidth:349,showFilterOptionsWithOneItem:true},apiDelay:0,imageDelay:0,priceDelay:0});
    await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    const geometry=await evaluate(`(()=>{const s=document.querySelector('#cfp-sidebar'),intro=document.querySelector('#fixture-intro'),r=s.getBoundingClientRect(),heading=s.querySelector('h2').getBoundingClientRect(),count=s.querySelector('.cfp-vertical-result-count').getBoundingClientRect();return {parent:s.parentElement.className,width:r.width,sidebarTop:r.top,sortTop:document.querySelector('#cfp-top-bar').getBoundingClientRect().top,gridTop:document.querySelector('#cfp-products-container').getBoundingClientRect().top,introBottom:intro.getBoundingClientRect().bottom,introParent:intro.parentElement.id,headingTop:heading.top,countTop:count.top,countRight:count.right,headingRight:heading.right,duplicates:[...document.querySelectorAll('#cfp-top-bar .cfp-product-count')].some(e=>e.getBoundingClientRect().width>0),groupSearch:[...s.querySelectorAll('.cfp-search-input')].some(e=>e.getBoundingClientRect().width>0),search:!!s.querySelector('.cfp-collection-search')};})()`);
    assert.ok(geometry.parent.includes('cfp-layout-wrapper'));assert.equal(geometry.introParent,'fixture-main');assert.equal(geometry.width,349);
    assert.ok(Math.abs(geometry.headingTop-geometry.countTop)<2);assert.ok(geometry.countRight>geometry.headingRight+30);
    assert.ok(Math.abs(geometry.sidebarTop-geometry.sortTop)<=1&&geometry.sidebarTop<geometry.gridTop&&geometry.sidebarTop>=geometry.introBottom,JSON.stringify(geometry));assert.equal(geometry.duplicates,false);assert.equal(geometry.groupSearch,false);
    assert.equal(geometry.search,false);
    assert.equal(await evaluate("document.querySelector('#fixture-faq').getBoundingClientRect().left===document.querySelector('#fixture-intro').getBoundingClientRect().left"),true);
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(400);
    assert.equal(await evaluate("document.querySelector('#fixture-main').classList.contains('cfp-vertical-page-layout')"),false);
    await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar').parentElement.tagName"),'BODY');
    await evaluate("const toggle=document.querySelector('#cfp-sidebar .cfp-group__toggle');if(toggle.getAttribute('aria-expanded')==='false')toggle.click()");
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar .cfp-search-input').getBoundingClientRect().width>0"),true,JSON.stringify(await evaluate("({width:innerWidth,body:document.body.className,sidebar:document.querySelector('#cfp-sidebar').className,styles:getComputedStyle(document.querySelector('#cfp-sidebar')).display,group:document.querySelector('#cfp-sidebar .cfp-group__content').className,wrap:getComputedStyle(document.querySelector('#cfp-sidebar .cfp-search-input-wrap')).display})")));
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.cfp-vertical-summary')).display"),'none');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await delay(400);
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar').parentElement.classList.contains('cfp-layout-wrapper')"),true);
    assert.equal(await evaluate("document.querySelectorAll('#fixture-intro').length"),1);assert.equal(await evaluate("document.querySelector('#fixture-footer').parentElement.id"),'fixture-main');
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('vertical refinement has no search bar and existing empty query links remain clearable',async()=>{
    await control({reset:true,themeIntro:true,realToolbar:true,productCount:30,noPins:true,noMerchandising:true,precompute:true,noMatchQuery:'zznomatches',
      filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{}}],
      globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true},apiDelay:0,imageDelay:0,priceDelay:0});
    await navigate('?q=zznomatches');await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')&&document.querySelector('.cfp-vertical-result-count').textContent==='0 products'");
    assert.equal(await evaluate("document.querySelector('.cfp-collection-search')"),null);
    assert.equal(await evaluate("document.querySelector('.cfp-vertical-clear')"),null);
    assert.equal(await evaluate("document.querySelector('.cfp-breadcrumb-clear').textContent"),'Clear all');
    const before=(await getState()).state.builds;
    await evaluate("document.querySelector('[data-type=\"collection-query\"] .cfp-breadcrumb-remove').click()");
    await wait("!new URLSearchParams(location.search).has('q')&&document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.equal((await getState()).state.builds,before,'clearing rebuilt collection data');assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('vertical refinement preserves existing query links through sort, Load more, reload and browser history',async()=>{
    await control({reset:true,themeIntro:true,realToolbar:true,productCount:50,noPins:true,noMerchandising:true,precompute:true,
      filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{multipleSelection:true}}],
      globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true},apiDelay:0,imageDelay:0,priceDelay:0});
    await navigate('?q=fixture');await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    assert.equal(await evaluate("new URLSearchParams(location.search).get('q')"),'fixture');
    await evaluate("document.querySelector('#cfp-load-more-btn').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal').length===50");
    assert.equal((await getState()).allRequests.at(-1).query,'fixture');assert.equal((await getState()).allRequests.at(-1).page,'2');
    await evaluate("document.querySelector('.cfp-custom-sort__option[data-value=\"price-ascending\"]').click()");
    await wait("new URLSearchParams(location.search).get('sort_by')==='price-ascending'&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    assert.equal((await getState()).allRequests.at(-1).query,'fixture');
    await send('Page.reload');await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    assert.equal(await evaluate("new URLSearchParams(location.search).get('q')"),'fixture');
    await evaluate("history.pushState(null,'','/collections/fixture?q=history');dispatchEvent(new PopStateEvent('popstate'))");
    await wait("new URLSearchParams(location.search).get('q')==='history'&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    assert.equal((await getState()).allRequests.at(-1).query,'history');assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('toolbar color picker previews presets and hex input before applying or restoring page color',async()=>{
    await send('Page.navigate',{url:origin+'/bar-color-admin'});
    await wait("!!document.querySelector('select[aria-label=\"Filter and sort bar background\"]')");
    await evaluate("const select=document.querySelector('select');select.value='custom';select.dispatchEvent(new Event('change',{bubbles:true}))");
    await wait("!!document.querySelector('input[type=color]')");
    await evaluate("document.querySelector('button[aria-label=\"Use Cream\"]').click()");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('[aria-label=\"Filter bar color preview\"]')).backgroundColor"),'rgb(251, 247, 245)');
    assert.deepEqual(await evaluate('savedColors'),[]);
    const typeHex=value=>evaluate(`(()=>{const input=document.querySelector('input[aria-label="Bar background hex color"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await typeHex('12');
    assert.equal(await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Apply color').disabled"),true);
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Bar background hex color\"]').getAttribute('aria-invalid')"),'true');
    await typeHex('#a1b2c3');
    await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Apply color').click()");
    assert.deepEqual(await evaluate('savedColors'),['#a1b2c3']);
    await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Use page background').click()");
    assert.deepEqual(await evaluate('savedColors'),['#a1b2c3','']);
    assert.equal(await evaluate("document.querySelector('select').value"),'page');
  });
  await test('vertical filters match the drawer width and surrounding section background',async()=>{
    const {identifier}=await send('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('DOMContentLoaded',()=>{const app=document.querySelector('.cfp-v1-app-container');const section=document.createElement('section');section.style.backgroundColor='#fbf7f5';app.before(section);section.append(app);document.body.style.backgroundColor='#ffffff';},{once:true});`});
    try{
      const filterSettings=[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Designers',displayMode:'List',config:{}}];
      await control({reset:true,realToolbar:true,productCount:30,precompute:true,filterSettings,globalSettings:{desktopFilterLayout:'drawer',showFilterOptionsWithOneItem:true},apiDelay:0,assetDelay:0,imageDelay:0,priceDelay:0});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");
      const drawerWidth=await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().width");assert.equal(drawerWidth,420);
      await control({reset:true,realToolbar:true,productCount:30,precompute:true,filterSettings,globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true,integrations:{filterBarBackgroundColor:'#111111'}},apiDelay:0,assetDelay:0,imageDelay:0,priceDelay:0});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().width"),drawerWidth);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar')).backgroundColor"),'rgb(251, 247, 245)');
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar .cfp-sidebar__header')).backgroundColor"),'rgb(251, 247, 245)');
      await wait("getComputedStyle(document.querySelector('#cfp-top-bar')).backgroundColor==='rgb(17, 17, 17)'");
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-top-bar')).backgroundColor"),'rgb(17, 17, 17)');
      for(const width of [900,390,1440]){
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<769});await delay(350);
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+2"),true);
        if(width>768)assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().width"),420);
      }
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }finally{await send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
  });
  await test('horizontal filters recover missing toolbar containers and remain usable when resized',async()=>{
    const filterSettings=Array.from({length:8},(_,i)=>({id:'horizontal-'+i,isEnabled:true,filterType:'vendor',label:'Filter option group '+(i+1),displayMode:'List',config:{}}));
    for(const realToolbar of [false,true]){
      await control({reset:true,realToolbar,productCount:30,precompute:true,filterSettings,globalSettings:{desktopFilterLayout:'horizontal',showFilterOptionsWithOneItem:true},apiDelay:0,assetDelay:0,imageDelay:0,priceDelay:0});
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      assert.ok(await evaluate("document.querySelectorAll('#cfp-horizontal-filters .cfp-horizontal-pill').length>0"),'horizontal options were hidden when optional markup was missing');
      for(const width of [900,390,1440]){
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<769});await delay(350);
        if(width<769){await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open')"),true);await evaluate("document.querySelector('#cfp-apply-btn').click()");continue;}
        assert.ok(await evaluate("[...document.querySelectorAll('#cfp-horizontal-filters .cfp-horizontal-pill__btn')].some(e=>e.getBoundingClientRect().width>0)"));
        const extra=await evaluate("document.querySelectorAll('#cfp-horizontal-extra-filters .cfp-horizontal-pill').length");
        if(extra){await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-horizontal-extra-filters')).display"),'flex');await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");}
        assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+2"),true);
      }
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }
  });
  await test('filter editor adds and removes individual price bands and saves option search settings',async()=>{
    await send('Page.navigate',{url:origin+'/filter-controls-admin'});
    await wait("!!document.querySelector('input[aria-label=\"Range 1 minimum\"]')");
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Range 1 minimum\"]').value"),'0');
    assert.equal(await evaluate("document.querySelector('input[aria-label=\"Range 1 maximum\"]').value"),'0');
    await evaluate("document.querySelector('button[aria-label=\"Remove range 1\"]').click()");
    assert.equal(await evaluate("document.querySelectorAll('button[aria-label^=\"Remove range\"]').length"),1);
    await evaluate("document.querySelector('button[aria-label=\"Remove range 1\"]').click()");
    await wait("document.body.innerText.includes('No price ranges.')");
    await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent==='Add price range').click()");
    await wait("!!document.querySelector('input[aria-label=\"Range 1 minimum\"]')");
    await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Range 1 minimum"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('input[aria-label="Limit maximum for range 1"]').click();for(const label of document.querySelectorAll('fieldset label'))if(label.textContent.includes('Show option search on desktop'))label.querySelector('input').click();})()`);
    await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Range 1 maximum"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await evaluate("[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='UPDATE').click()");
    await wait("!!window.lastSaved");
    const saved=await evaluate('window.lastSaved');assert.equal(saved.priceRanges.length,1);assert.equal(saved.priceRanges[0].from,'0');assert.equal(saved.priceRanges[0].to,'100');assert.equal(saved.advanced.desktopSearchBox,true);assert.equal(saved.advanced.mobileSearchBox,false);
    await evaluate("document.querySelector('#reopen').click()");
    await wait("document.querySelector('input[aria-label=\"Range 1 maximum\"]')?.value==='100'");
    assert.equal(await evaluate("[...document.querySelectorAll('fieldset label')].find(e=>e.textContent.includes('Show option search on desktop')).querySelector('input').checked"),true);
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('filter option search respects desktop and mobile switches including Price bands',async()=>{
    for(const [desktop,mobile]of [[true,false],[false,true],[false,false]])for(const width of [1440,390]){
      const advanced={desktopSearchBox:desktop,mobileSearchBox:mobile};
      const filterSettings=[{id:'price',isEnabled:true,filterType:'price',label:'Price',displayMode:'List',config:{advanced,priceRanges:[{from:0,to:10,label:'{0} - {1}'},{from:10,to:20,label:'{0} - {1}'},{from:20,to:'',label:'From {0}'}]}},
        {id:'vendor',isEnabled:true,filterType:'vendor',label:'Designers',displayMode:'List',config:{advanced}},
        {id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',displayMode:'Box',config:{advanced}},
        {id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'Swatch',config:{advanced,swatchConfig:{colors:{Blue:'#0000ff'}}}}];
      const productFields=Object.fromEntries(Array.from({length:24},(_,i)=>[String(i+1),{options:[{name:'Color',values:['Blue','Red']},{name:'Size',values:['S','M','L']}]}]));
      await control({reset:true,productCount:24,precompute:true,filterSettings,productFields,globalSettings:{desktopFilterLayout:'drawer',showFilterOptionsWithOneItem:true},apiDelay:0,assetDelay:0,imageDelay:0,priceDelay:0});
      await send('Emulation.setDeviceMetricsOverride',{width,height:744,deviceScaleFactor:1,mobile:width<768});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      const enabled=width<768?mobile:desktop;
      assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar .cfp-vendor-search').length"),enabled?4:0);
      if(enabled){
        await evaluate("window.priceFacetLookups=[];const fetchOriginal=window.fetch;window.fetch=(url,...args)=>{if(String(url).includes('/api/facet'))priceFacetLookups.push(String(url));return fetchOriginal(url,...args)};const input=document.querySelector('#cfp-sidebar input[data-input-name=price]');input.value='From';input.dispatchEvent(new Event('input',{bubbles:true}))");
        await delay(500);
        assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar input[name=price]').length"),3);
        assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar .cfp-checkbox:not(.cfp-search-hidden) input[name=price]').length"),1);
        assert.deepEqual(await evaluate('priceFacetLookups'),[]);
        assert.equal((await cards()).length,24);
      }
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }
  });
  await test('filter groups grow to fit all options with only the drawer scrolling',async()=>{
    const sleeves=Array.from({length:16},(_,i)=>'Sleeve:'+i);
    const filterSettings=[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Designers',displayMode:'List',config:{advanced:{showMoreType:'Scrollbar',maxHeight:'80px'}}},
      {id:'sleeve',isEnabled:true,filterType:'tag',label:'Sleeve',displayMode:'Swatch',config:{prefix:'Sleeve:',advanced:{showMoreType:'Scrollbar',maxHeight:'80px'},swatchConfig:{layout:'Grid',showLabel:true,colors:Object.fromEntries(sleeves.map(value=>[value,{type:'image',value:'/image/1.svg'}]))}}}];
    const productFields=Object.fromEntries(Array.from({length:24},(_,i)=>[String(i+1),{vendor:'Designer '+i,tags:sleeves}]));
    for(const width of [1440,390]){
      await control({reset:true,productCount:24,precompute:true,noPins:true,noMerchandising:true,filterSettings,productFields,globalSettings:{desktopFilterLayout:'drawer',showFilterOptionsWithOneItem:true},apiDelay:0,assetDelay:0,imageDelay:0,priceDelay:0});
      await send('Emulation.setDeviceMetricsOverride',{width,height:744,deviceScaleFactor:1,mobile:width<768});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click();for(const b of document.querySelectorAll('#cfp-sidebar .cfp-group__toggle[aria-expanded=false]'))b.click()");
      const result=await evaluate("(()=>{const body=document.querySelector('#cfp-sidebar .cfp-sidebar__body');return {drawerScrolls:body.scrollHeight>body.clientHeight,groups:[...document.querySelectorAll('#cfp-sidebar .cfp-group__content')].map(e=>({height:e.getBoundingClientRect().height,clipped:[e,...e.querySelectorAll('*')].some(n=>['auto','scroll'].includes(getComputedStyle(n).overflowY)&&n.scrollHeight>n.clientHeight+1)})),vendors:document.querySelectorAll('#cfp-sidebar input[name=vendor]').length,sleeves:document.querySelectorAll('#cfp-sidebar input[name=tag]').length}})()");
      assert.equal(result.vendors,24);assert.equal(result.sleeves,16);assert.equal(result.drawerScrolls,true);
      assert.ok(result.groups.every(g=>g.height>80&&!g.clipped),JSON.stringify(result));
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }
  });
  await test('image filter labels align from the top and drawer Reset and Done remain visible',async()=>{
    const names={Length:['Mini','Midi','Maxi','Floor Length'],Sleeve:['Cap Sleeve','Long Sleeve','Off The Shoulder','One Shoulder']};
    const filterSettings=Object.entries(names).map(([label,values])=>({id:label,isEnabled:true,filterType:'tag',label,displayMode:'Swatch',config:{prefix:label+':',swatchConfig:{layout:'Grid',showLabel:true,colors:Object.fromEntries(values.map(value=>[label+':'+value,{type:'image',value:'/image/1.svg'}]))}}}));
    const productFields=Object.fromEntries(Array.from({length:8},(_,i)=>[String(i+1),{tags:Object.entries(names).flatMap(([label,values])=>values.map(value=>label+':'+value))}]));
    for(const width of [1440,390]){
      await control({reset:true,productCount:8,precompute:true,noPins:true,noMerchandising:true,filterSettings,productFields,globalSettings:{desktopFilterLayout:'drawer',showFilterOptionsWithOneItem:true},apiDelay:0,assetDelay:0,imageDelay:0,priceDelay:0});
      await send('Emulation.setDeviceMetricsOverride',{width,height:744,deviceScaleFactor:1,mobile:width<768});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click();for(const b of document.querySelectorAll('#cfp-sidebar .cfp-group__toggle[aria-expanded=false]'))b.click()");
      const grids=await evaluate("[...document.querySelectorAll('#cfp-sidebar .cfp-color-grid--images')].map(g=>{const cells=[...g.children];return {images:cells.map(e=>e.querySelector('.cfp-swatch-circle').getBoundingClientRect().top),labels:cells.map(e=>e.querySelector('.cfp-swatch-label').getBoundingClientRect().top),visible:cells.every(e=>e.querySelector('.cfp-swatch-label').getBoundingClientRect().height>0)}})");
      assert.equal(grids.length,2);for(const grid of grids){assert.equal(grid.visible,true);assert.ok(Math.max(...grid.images)-Math.min(...grid.images)<1);assert.ok(Math.max(...grid.labels)-Math.min(...grid.labels)<1);}
      assert.equal(await evaluate("document.querySelector('#cfp-clear-btn').textContent.trim()"),'Reset');
      assert.equal(await evaluate("document.querySelector('#cfp-apply-btn').textContent.trim()"),'Done');
      const footer=await evaluate("[...document.querySelectorAll('.cfp-sidebar__footer button')].map(e=>{const r=e.getBoundingClientRect();return {height:r.height,bottom:r.bottom,viewport:visualViewport.height}})");
      assert.equal(footer.length,2);assert.ok(footer.every(r=>r.height>=40&&r.bottom<=r.viewport-12),JSON.stringify(footer));
      await evaluate("document.querySelector('#cfp-sidebar input[value=\"Length:Mini\"]').click();document.querySelector('#cfp-sidebar input[value=\"Sleeve:Cap Sleeve\"]').click();document.querySelector('#cfp-clear-btn').click()");
      assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar input:checked').length"),0);
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open')"),true);
      await evaluate("document.querySelector('#cfp-sidebar input[value=\"Length:Mini\"]').click();document.querySelector('#cfp-apply-btn').click()");
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open')"),false);
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar input[value=\"Length:Mini\"]').checked"),true);
      await wait("!document.querySelector('#cfp-sidebar.cfp-loading')");assert.deepEqual(await evaluate('browserErrors'),[]);
    }
  });
  await test('Price style defaults to checkboxes across stores and Size defaults to four configurable columns',async()=>{
    const bands=[{from:0,to:10,label:'{0} - {1}'},{from:10,to:'',label:'From {0}'}];
    const filterSettings=[{id:'price',isEnabled:true,filterType:'price',label:'Price',displayMode:'Range',config:{priceRanges:bands}},
      {id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',displayMode:'Box',config:{}}];
    const productFields=Object.fromEntries(Array.from({length:12},(_,i)=>[String(i+1),{options:[{name:'Size',values:['XS','S','M','L','XL','XXL','2XL','3XL']}]}]));
    for(const [presentation,columns,slider]of [[{},4,false],[{sizeOptionsPerRow:3,priceFilterDisplayMode:'Range'},3,true],[{sizeOptionsPerRow:6,priceFilterDisplayMode:'List'},6,false]]){
      await control({reset:true,productCount:12,noPins:true,noMerchandising:true,precompute:true,filterSettings,productFields,
        globalSettings:{showFilterOptionsWithOneItem:true,desktopFilterLayout:'drawer',integrations:presentation},apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click();for(const b of document.querySelectorAll('#cfp-sidebar .cfp-group__toggle[aria-expanded=false]'))b.click()");
      assert.equal(await evaluate("!!document.querySelector('#cfp-sidebar input[type=range]')"),slider);
      if(!slider)assert.deepEqual(await evaluate("[...document.querySelectorAll('#cfp-sidebar input[name=price]')].map(e=>e.value)"),['0:10','10:Infinity']);
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar .cfp-size-grid')).gridTemplateColumns.split(' ').length"),columns);
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
      await evaluate("if(!document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open'))document.querySelector('#cfp-drawer-trigger-btn').click();for(const b of document.querySelectorAll('#cfp-sidebar .cfp-group__toggle[aria-expanded=false]'))b.click()");
      await wait("getComputedStyle(document.querySelector('#cfp-sidebar .cfp-size-grid')).gridTemplateColumns.split(' ').length==="+columns);
      assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+2"),true);
      assert.deepEqual(await evaluate('browserErrors'),[]);
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    }
  });
  await test('filter and sort bar background follows its page section, custom color and reset',async()=>{
    const {identifier}=await send('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('DOMContentLoaded',()=>{const app=document.querySelector('.cfp-v1-app-container');const section=document.createElement('section');section.style.backgroundColor='#fbf7f5';app.before(section);section.append(app);document.body.style.backgroundColor='#ffffff';},{once:true});`});
    try{
      for(const [settings,expected]of [[{},'rgb(251, 247, 245)'],[{integrations:{filterBarBackgroundColor:'#a1b2c3'}},'rgb(161, 178, 195)'],[{integrations:{filterBarBackgroundColor:''}},'rgb(251, 247, 245)']]){
        await control({reset:true,productCount:30,precompute:true,hold:true,globalSettings:settings,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0,
          filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'List'}]});
        await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-top-bar')).backgroundColor"),expected);
        await evaluate("scrollTo(0,600);document.querySelector('#cfp-sidebar input[name=\"option-Color\"]').click()");
        await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-top-bar')).backgroundColor"),expected);
        assert.deepEqual(await evaluate('browserErrors'),[]);
      }
    }finally{await send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
  });
  await test('vertical filter heading and reserved column appear only when filters are ready',async()=>{
    await control({reset:true,realToolbar:true,productCount:30,cardSnapshots:true,publishedPages:true,headRenderer:true,noPins:true,noMerchandising:true,precompute:true,
      filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{}}],
      globalSettings:{desktopFilterLayout:'vertical',verticalFilterWidth:349,showFilterOptionsWithOneItem:true},savedFilterDelay:1200,apiDelay:0,imageDelay:0,priceDelay:0});
    await control({publishFirst50:true});await control({apiDelay:5000});
    await navigate();await evaluate("document.body.classList.add('cfp-vertical-layout')");
    const geometry=()=>evaluate("(()=>{const s=document.querySelector('#cfp-sidebar'),w=document.querySelector('.cfp-layout-wrapper'),g=document.querySelector('#cfp-products-container'),summary=s.querySelector('.cfp-vertical-summary');return {ready:document.body.classList.contains('cfp-filters-ready'),sidebar:s.getBoundingClientRect().width,summary:!!summary&&summary.getBoundingClientRect().width>0,gap:g.getBoundingClientRect().left-w.getBoundingClientRect().left-parseFloat(getComputedStyle(w).paddingLeft)};})()");
    const pending=await geometry();assert.equal(pending.ready,false);assert.equal(pending.sidebar,0);assert.equal(pending.summary,false);assert.equal(pending.gap,0);
    await wait("document.body.classList.contains('cfp-filters-ready')",3500);
    const ready=await geometry();assert.equal(ready.sidebar,349);assert.equal(ready.summary,true);assert.equal(ready.gap,373);assert.equal((await cards()).length,0,'filter readiness waited for products');
    await control({apiDelay:200});await evaluate("document.querySelector('#cfp-sidebar input[type=checkbox]').click()");await delay(30);
    assert.equal((await geometry()).sidebar,349,'existing filter column disappeared during selection');
    await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");assert.deepEqual(await evaluate('browserErrors'),[]);
    await control({reset:true,realToolbar:true,productCount:30,precompute:true,filterSettings:[],globalSettings:{desktopFilterLayout:'vertical'},apiDelay:0,imageDelay:0,priceDelay:0});
    await navigate();await wait("window._cfpInitialized&&document.body.classList.contains('cfp-no-filters')");
    const empty=await geometry();assert.equal(empty.ready,false);assert.equal(empty.sidebar,0);assert.equal(empty.summary,false);assert.equal(empty.gap,0);
  });
  await test('saved filters are usable before a delayed product response finishes',async()=>{
    await control({reset:true,productCount:70,cardSnapshots:true,publishedPages:true,delay:0,priceDelay:0,imageDelay:0,
      headRenderer:true,savedFilterDelay:300,globalSettings:{desktopFilterLayout:'drawer'},filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'List'}]});
    await control({publishFirst50:true});
    await control({apiDelay:5000});
    await navigate();
    await evaluate("window.dispatchEvent(new Event('resize'))");
    await wait("document.querySelectorAll('#cfp-sidebar input[type=checkbox]').length>0&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')",3000);
    const filtersMs=await evaluate("performance.getEntriesByName('cfp-filters-ready')[0]?.startTime");
    assert.ok(filtersMs<1000,'filters were not ready under one second: '+filtersMs);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-drawer-trigger-btn')).display!=='none'&&document.querySelector('#cfp-drawer-trigger-btn').getBoundingClientRect().width>0"),true);
    assert.equal((await cards()).length,0);
    await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click();document.querySelector('#cfp-sidebar input[type=checkbox]').click();document.querySelector('#cfp-apply-btn').click()");
    await wait("new URLSearchParams(location.search).get('option_Color')==='Blue'");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25",20000);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {filtersMs,productDelayMs:5000,liveTiming:false};
  });
  await test('saved filters retry an unavailable early read and recover before delayed product cards',async()=>{
    await control({reset:true,productCount:70,cardSnapshots:true,publishedPages:true,headRenderer:true,delay:0,priceDelay:0,imageDelay:0,
      globalSettings:{desktopFilterLayout:'vertical'},filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{}}]});
    await control({publishFirst50:true});await control({apiDelay:5000,savedFilterFailures:2});
    await navigate();await wait("performance.getEntriesByName('cfp-filters-ready').length>0",3000);
    const filtersMs=await evaluate("performance.getEntriesByName('cfp-filters-ready')[0].startTime");
    assert.ok(filtersMs<2500,'saved-filter recovery waited for products: '+filtersMs);
    assert.equal((await cards()).length,0);assert.equal((await getState()).state.savedFilterAttempts,3);
    assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar input[type=checkbox]').length>0"),true);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {filtersMs,simulatedProductDelayMs:5000,transientSavedFilterMisses:2};
  });
  await test('vertical filter wheel scrolling passes to the page at both edges',async()=>{
    await control({reset:true,realToolbar:true,productCount:30,noPins:true,noMerchandising:true,precompute:true,
      productFields:Object.fromEntries(Array.from({length:30},(_,i)=>[String(i+1),{vendor:'Brand '+i}])),
      filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',label:'Brand',config:{}}],
      globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true},apiDelay:0,imageDelay:0,priceDelay:0});
    await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar')).scrollbarWidth"),'none');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar'),'::-webkit-scrollbar').width"),'0px');
    const wheel=async deltaY=>{
      const point=await evaluate("(()=>{const r=document.querySelector('#cfp-sidebar').getBoundingClientRect();return {x:r.left+70,y:Math.max(r.top+80,150)};})()");
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY});await delay(400);
    };
    await evaluate("scrollTo(0,700);document.querySelector('#cfp-sidebar').scrollTop=100");await delay(250);
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar').scrollHeight>document.querySelector('#cfp-sidebar').clientHeight+200"),true);
    const middle=await evaluate("({page:scrollY,inner:document.querySelector('#cfp-sidebar').scrollTop})");
    await wheel(100);assert.ok(await evaluate("document.querySelector('#cfp-sidebar').scrollTop>"+middle.inner));assert.equal(await evaluate('scrollY'),middle.page);
    await evaluate("document.querySelector('#cfp-sidebar').scrollTop=document.querySelector('#cfp-sidebar').scrollHeight");await delay(250);
    const bottomPage=await evaluate('scrollY');await wheel(350);assert.ok(await evaluate('scrollY>'+bottomPage),'bottom edge trapped the page');
    await evaluate("scrollTo(0,700);document.querySelector('#cfp-sidebar').scrollTop=0");await delay(250);
    const topPage=await evaluate('scrollY');await wheel(-350);assert.ok(await evaluate('scrollY<'+topPage),'top edge trapped the page');
    await evaluate("document.querySelector('#cfp-sidebar .cfp-group__toggle').click();scrollTo(0,700)");await delay(250);
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar').scrollHeight>document.querySelector('#cfp-sidebar').clientHeight"),false);
    const collapsedPage=await evaluate('scrollY');await wheel(200);assert.ok(await evaluate('scrollY>'+collapsedPage),'short filters trapped the page');
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('vertical sidebar scrolls away at the collection boundary before FAQ and footer',async()=>{
    await control({reset:true,themeIntro:true,realToolbar:true,productCount:30,noPins:true,noMerchandising:true,precompute:true,
      filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{}}],
      globalSettings:{desktopFilterLayout:'vertical',verticalFilterWidth:349,showFilterOptionsWithOneItem:true},apiDelay:0,imageDelay:0,priceDelay:0});
    await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    await evaluate("document.querySelector('#fixture-faq').style.height='300px';document.querySelector('#fixture-footer').style.height='900px'");
    const boundary=await evaluate("(()=>{const b=document.querySelector('.cfp-layout-wrapper'),a=document.querySelector('#fixture-app-section');return {bottom:b.getBoundingClientRect().bottom,appBottom:a.getBoundingClientRect().bottom};})()");
    assert.ok(boundary.bottom<=boundary.appBottom+1,JSON.stringify(boundary));
    await evaluate("scrollTo(0,document.querySelector('#fixture-app-section').getBoundingClientRect().bottom+scrollY-80)");await delay(200);
    const end=await evaluate("(()=>{const s=document.querySelector('#cfp-sidebar').getBoundingClientRect(),a=document.querySelector('#fixture-app-section').getBoundingClientRect(),f=document.querySelector('#fixture-faq').getBoundingClientRect();return {top:s.top,bottom:s.bottom,appBottom:a.bottom,faqTop:f.top};})()");
    assert.ok(end.top<0,JSON.stringify(end));assert.ok(end.bottom<=end.appBottom+1,JSON.stringify(end));assert.ok(end.bottom<=end.faqTop+1,JSON.stringify(end));
    await evaluate("scrollTo(0,document.querySelector('#fixture-footer').getBoundingClientRect().top+scrollY-400)");await delay(200);
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getBoundingClientRect().bottom<=document.querySelector('#fixture-footer').getBoundingClientRect().top+1"),true);
    for(const width of [390,1440,390,1440]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<769});await delay(300);
      assert.equal(await evaluate("document.querySelectorAll('.cfp-vertical-sidebar-boundary').length"),0);
      assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar').length"),1);
    }
    assert.deepEqual(await evaluate('browserErrors'),[]);return end;
  });
  await test('vertical spacing has no outer gutter and follows the collection section background',async()=>{
    const {identifier}=await send('Page.addScriptToEvaluateOnNewDocument',{source:"document.addEventListener('DOMContentLoaded',()=>{document.querySelector('#fixture-app-section').style.backgroundColor='#fbf7f5';},{once:true});"});
    try{
      await control({reset:true,themeIntro:true,realToolbar:true,productCount:30,noPins:true,noMerchandising:true,precompute:true,
        filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{}}],
        globalSettings:{desktopFilterLayout:'vertical',verticalFilterWidth:349,showFilterOptionsWithOneItem:true},apiDelay:0,imageDelay:0,priceDelay:0});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar.cfp-loading')");
      const spacing=await evaluate("(()=>{const s=document.querySelector('#cfp-sidebar'),m=s.closest('.cfp-layout-wrapper'),intro=document.querySelector('#cfp-products-container');return {gap:getComputedStyle(m).columnGap,background:getComputedStyle(document.querySelector('#fixture-app-section')).backgroundColor,sidebar:getComputedStyle(s).backgroundColor,width:s.getBoundingClientRect().width,right:s.getBoundingClientRect().right,left:intro.getBoundingClientRect().left,padding:getComputedStyle(s).paddingLeft};})()");
      assert.equal(spacing.gap,'24px');assert.equal(spacing.background,'rgb(251, 247, 245)');assert.equal(spacing.sidebar,spacing.background);
      assert.equal(spacing.width,349);assert.equal(spacing.left-spacing.right,24);assert.equal(spacing.padding,'16px');
      await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(400);
      assert.equal(await evaluate("document.querySelector('#fixture-main').style.getPropertyValue('--cfp-page-bg')"),'');
      assert.equal(await evaluate("document.querySelector('#fixture-main').classList.contains('cfp-vertical-page-layout')"),false);
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }finally{await send('Page.removeScriptToEvaluateOnNewDocument',{identifier});await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});}
  });
  await test('saved filters apply changed layout and widths before delayed product cards',async()=>{
    for (const layout of ['vertical','horizontal','drawer']) {
      await control({reset:true,productCount:70,cardSnapshots:true,publishedPages:true,delay:0,priceDelay:0,imageDelay:0,headRenderer:true,savedFilterDelay:150,
        globalSettings:{desktopFilterLayout:'drawer'},filterSettings:[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'List'}]});
      await control({publishFirst50:true});
      await control({apiDelay:5000,globalSettings:{desktopFilterLayout:layout,integrations:{drawerWidth:300,verticalFilterWidth:360}}});
      await navigate();
      await wait("performance.getEntriesByName('cfp-filters-ready').length>0",3000);
      assert.equal(await evaluate('cfpGlobalSettings.desktopFilterLayout'),layout);
      assert.equal((await cards()).length,0,'filters waited for cards');
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar').style.getPropertyValue('--cfp-drawer-width')"),'300px');
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar').style.getPropertyValue('--cfp-vertical-width')"),'360px');
      assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar input[type=checkbox]').length>0"),true);
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }
  });
  await test('review stars initialize on dynamic cards and Load more',async()=>{
    const {identifier}=await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.reviewsIoStore='fixture-store';window.reviewCalls=[];window.ratingSnippet=(selector,settings)=>{reviewCalls.push({selector,store:settings.store,count:document.querySelectorAll('.ruk_rating_snippet').length});};`});
    try{
      await control({reset:true,productCount:50,cardSnapshots:true,publishedPages:true,delay:0,priceDelay:0,imageDelay:0});
      await control({publishFirst50:true});
      await navigate();
      await wait("document.querySelectorAll('.cfp-product-card--reveal .ruk_rating_snippet').length===25");
      await wait('window.reviewCalls.length>0');
      assert.ok((await evaluate("document.querySelector('.ruk_rating_snippet').getAttribute('data-sku')")).startsWith('dress-1;'));
      assert.equal(await evaluate('window.reviewCalls.at(-1).store'),'fixture-store');
      await evaluate("document.querySelector('#cfp-load-more-btn').click()");
      await wait("document.querySelectorAll('.cfp-product-card--reveal .ruk_rating_snippet').length===50");
      await wait('window.reviewCalls.some(call=>call.count===50)');
    }finally{await send('Page.removeScriptToEvaluateOnNewDocument',{identifier});}
  });
  await test('country stock publications preserve fast pages, market switches and inventory refresh',async()=>{
    const all=Array.from({length:65},(_,i)=>String(i+1));
    const stock={version:'v1',ids:{US:all,IN:all.filter(id=>!['1','3'].includes(id))}};
    await control({reset:true,productCount:65,cardSnapshots:true,publishedPages:true,countryStock:stock,delay:0,priceDelay:0,imageDelay:0});
    await control({publishFirst50:true,publishCountry:'US'});
    await control({publishFirst50:true,publishCountry:'IN'});
    const preparedBrowses=(await getState()).trace.candidateBrowses;
    await navigate('?country=IN');await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.equal((await getState()).trace.candidateBrowses,preparedBrowses,'a prepared country page must not rerun the collection ranking scan');
    const india=await cards();assert.ok(!india.includes('1')&&!india.includes('3'));
    await evaluate("window.firstCard=document.querySelector('.cfp-product-card--reveal');document.querySelector('#cfp-load-more-btn').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===50");
    assert.equal(new Set(await cards()).size,50);assert.equal(await evaluate("window.firstCard===document.querySelector('.cfp-product-card--reveal')"),true);
    await navigate('?country=US');await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.equal((await cards())[0],'1');
    stock.version='v2';stock.ids.IN=stock.ids.IN.filter(id=>id!=='2');
    await control({countryStock:stock,publishFirst50:true,publishCountry:'IN'});
    await navigate('?country=IN');await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.ok(!(await cards()).some(id=>['1','2','3'].includes(id)));
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {indiaTotal:63,updatedIndiaTotal:62,usaTotal:65,initialCards:25,afterLoadMore:50,liveTiming:false};
  });
  console.log('Headless browser connected: '+version.product);

  await test('sort updates the URL and restores on browser Back',async()=>{
    await control({reset:true,hold:false,precompute:true,early:true,delay:20,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await evaluate("document.querySelector('.cfp-custom-sort__option[data-value=\"price-ascending\"]').click()");
    await wait("new URLSearchParams(location.search).get('sort_by')==='price-ascending'&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await evaluate('history.back()');await wait("!new URLSearchParams(location.search).has('sort_by')&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    assert.equal(await evaluate("document.querySelector('#cfp-custom-sort-label')?.textContent.trim()"),await evaluate("document.querySelector('.cfp-custom-sort__option[data-value=\"best-selling\"]')?.textContent.trim()"));
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });

  await test('available price sort variants select the lowest price and hide sold-out swatches',async()=>{
    await control({reset:true,productCount:25,hold:false,precompute:true,delay:0,priceDelay:0,imageDelay:0,
      marketPriceReady:true,globalSettings:{showOnlyInStock:true},productFields:{'1':{priceMin:19,priceMax:29,marketPriceMin_US:19,marketAvailablePriceMin_US:19}},
      productVariants:{'1':[
        {id:'101',price:19,available:false,option1:'Navy',imageUrl:'/image/1.svg'},
        {id:'102',price:19,available:true,option1:'Emerald',imageUrl:'/image/1.svg'},
        {id:'103',price:29,available:true,option1:'Teal',imageUrl:'/image/1.svg'},
      ]},nativeVariants:{'1':[
        {id:'101',price:19,available:false},
        {id:'102',price:29,available:true},
        {id:'103',price:19,available:true},
      ]}});
    await navigate('?sort_by=price-ascending');
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    const cardExpression=`[...document.querySelectorAll('.cfp-product-card__link')].find(link=>new URL(link.href).pathname==='/products/dress-1')?.closest('.cfp-product-card')`;
    await wait(`${cardExpression}?.querySelector('.cfp-product-card__price')?.textContent?.includes('$19.00')`);
    const card=await evaluate(`(()=>{const card=${cardExpression};return {href:card?.querySelector('.cfp-product-card__link')?.href,price:card?.querySelector('.cfp-product-card__price')?.textContent,colors:[...card?.querySelectorAll('.cfp-swatch-item')||[]].map(el=>el.dataset.cfpColor),active:card?.querySelector('.cfp-swatch-active')?.dataset.cfpColor};})()`);
    assert.match(card.href,/variant=103/);
    assert.match(card.price,/19\.00/);
    assert.deepEqual(card.colors,['Emerald','Teal']);
    assert.equal(card.active,'Teal');
    await evaluate(`${cardExpression}.querySelector('.cfp-swatch-item[data-cfp-color="Emerald"]').click()`);
    const selected=await evaluate(`(()=>{const card=${cardExpression};return {href:card.querySelector('.cfp-product-card__link').href,price:card.querySelector('.cfp-product-card__price').textContent,active:card.querySelector('.cfp-swatch-active')?.dataset.cfpColor};})()`);
    assert.match(selected.href,/variant=102/);
    assert.match(selected.price,/29\.00/);
    assert.equal(selected.active,'Emerald');
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });

  await test('compare-at and image sale badge follow separate live theme tags',async()=>{
    await control({reset:true,hold:false,precompute:true,early:true,delay:20,priceDelay:0,imageDelay:0,productFields:{'1':{tags:['show compare price']}},productVariants:{'1':[{id:'100',price:1,compareAtPrice:50,available:true,option1:'Blue',imageUrl:'/image/1.svg'}]}});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await wait("!!document.querySelector('.cfp-product-card__link[href*=\"/products/dress-1\"]')?.closest('.cfp-product-card')?.querySelector('.cfp-product-card__compare-price')",10000);
    const result=await evaluate("(()=>{const card=document.querySelector('.cfp-product-card__link[href*=\"/products/dress-1\"]')?.closest('.cfp-product-card');return {price:card?.querySelector('.cfp-product-card__price')?.textContent,compare:card?.querySelector('.cfp-product-card__compare-price')?.textContent,link:card?.querySelector('.cfp-product-card__link')?.href};})()");
    assert.match(result.compare,/50\.00/);assert.match(result.price,/1\.00/);assert.match(result.link,/variant=100/);
    assert.equal(await evaluate("!!document.querySelector('.cfp-product-card__link[href*=\"/products/dress-1\"]')?.closest('.cfp-product-card')?.querySelector('.cfp-product-card__badge')"),false);
    await control({reset:true,hold:false,precompute:true,early:true,delay:20,priceDelay:0,imageDelay:0,productFields:{'1':{tags:['Sale']}},productVariants:{'1':[{id:'100',price:1,compareAtPrice:50,available:true,option1:'Blue',imageUrl:'/image/1.svg'}]}});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await wait("!!document.querySelector('.cfp-product-card__link[href*=\"/products/dress-1\"]')?.closest('.cfp-product-card')?.querySelector('.cfp-product-card__price')",10000);
    assert.equal(await evaluate("!!document.querySelector('.cfp-product-card__link[href*=\"/products/dress-1\"]')?.closest('.cfp-product-card')?.querySelector('.cfp-product-card__compare-price')"),true);
    assert.equal(await evaluate("!!document.querySelector('.cfp-product-card__link[href*=\"/products/dress-1\"]')?.closest('.cfp-product-card')?.querySelector('.cfp-product-card__badge')"),true);
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });

  await test('cards render within two seconds while slow facets finish later and failed facets preserve cards',async()=>{
    await control({reset:true,hold:true,precompute:true,early:true,assetDelay:200,apiDelay:300,facetDelay:3000,clockOffset:0,cssDelay:0,
      filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Brand',config:{}}],globalSettings:{desktopFilterLayout:'drawer',showFilterOptionsWithOneItem:true}});
    await send('Network.clearBrowserCache');await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    const first=await cards(),at=await evaluate('cardSnapshots[0].at');if(!redisLayer)assert.ok(at<2000,'Cards exceeded fixture target: '+at);
    assert.ok(await evaluate("document.querySelectorAll('.cfp-product-card__price,.cfp-quick-view-btn,.cfp-product-swatches').length")>0);
    const firstImages=await evaluate("[...document.querySelectorAll('.cfp-product-card__image--primary')].map(e=>e.getAttribute('src'))");
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')"),true);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-drawer-trigger-btn')).display"),'none','filter button must wait for facets');
    await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')",10000);
    assert.notEqual(await evaluate("getComputedStyle(document.querySelector('#cfp-drawer-trigger-btn')).display"),'none','filter button should appear with ready facets');
    assert.equal((await cards()).length,25);assert.deepEqual((await cards()).slice(0,first.length),first);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.cfp-product-card__image--primary')].map(e=>e.getAttribute('src'))"),firstImages);
    let data=await getState();assert.equal(data.requests.length,1);assert.equal(data.facetResponses.length,1);
    await control({facetDelay:0,facetFailure:true});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");await wait("!!document.querySelector('.cfp-facet-error')");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-drawer-trigger-btn')).display"),'none','failed facets must not expose an empty drawer');
    assert.deepEqual(await cards(),first);assert.equal(await evaluate("!!document.querySelector('.cfp-order-error')"),false);
    await control({facetFailure:false});await evaluate("document.querySelector('.cfp-facet-error button').click()");await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    assert.deepEqual((await cards()).slice(0,first.length),first);assert.equal(await evaluate("!!document.querySelector('.cfp-facet-error')"),false);assert.deepEqual(await evaluate('browserErrors'),[]);
    await control({hold:false,early:false,assetDelay:0,apiDelay:0});
    return {cardsMs:Math.round(at),facetDelayMs:3000,twoSecondTargetMet:at<2000,liveTiming:false};
  });
  await test('first images and titles render while the full widget script is delayed',async()=>{
    await control({reset:true,hold:true,precompute:true,headRenderer:true,early:true,assetDelay:3500,apiDelay:250,cssDelay:0,facetDelay:500});
    await send('Network.clearBrowserCache');
    await send('Page.navigate',{url:origin+'/collections/fixture'});
    await wait("document.querySelectorAll('.cfp-initial-product').length>=5");
    assert.equal(await evaluate('!!window._cfpInitStarted'),false);
    await evaluate("(()=>{const overlay=document.createElement('div');overlay.id='cfp-skeleton-overlay';overlay.style.display='block';document.body.append(overlay);})()");
    await wait("getComputedStyle(document.getElementById('cfp-skeleton-overlay')).display==='none'");
    const early=await evaluate("[...document.querySelectorAll('.cfp-initial-product a')].map(a=>({href:a.getAttribute('href'),title:a.textContent,image:a.querySelector('img').getAttribute('src')}))");
    assert.ok(early.every(card=>card.title&&card.image&&card.href.includes('/products/')));
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    await wait("!document.querySelector('#cfp-first-row')");
    assert.deepEqual((await cards()).slice(0,early.length),early.map(card=>card.href.match(/dress-(\d+)/)[1]));
    assert.deepEqual(await evaluate('browserErrors'),[]);
    await control({hold:false,headRenderer:false,assetDelay:0,apiDelay:0,facetDelay:0});
  });
  await test('filter requests overlap card rendering and complete filter controls precede grid replacement',async()=>{
    const hook=await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
      window.filterScheduling={requests:[],renders:[]};
      const fetchOriginal=window.fetch;window.fetch=function(input,options){
        const url=new URL(typeof input==='string'?input:input.url,location.origin);
        const full=url.pathname==='/api/filter'&&url.searchParams.get('responseProfile')==='collection-v1';
        if(full)filterScheduling.requests.push(performance.now());
        return fetchOriginal.call(this,input,options).then(async response=>{
          if(!full||response.status!==200)return response;
          const payload=await response.json();
          // Model full metadata enriching the first card without changing IDs,
          // eligibility or facets, so this scenario needs a grid replacement.
          if(payload.products?.length)payload.products[0]._fixtureCanonicalDetails=true;
          return new Response(JSON.stringify(payload),{status:response.status,headers:{'Content-Type':'application/json'}});
        });
      };
      const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
      Object.defineProperty(Element.prototype,'innerHTML',{...descriptor,set(value){
        if(this.id==='cfp-products-container'&&String(value).includes('cfp-product-card--reveal')){
          filterScheduling.renders.push({at:performance.now(),filters:document.querySelectorAll('#cfp-sidebar input').length});
          const until=performance.now()+300;while(performance.now()<until){}
        }
        descriptor.set.call(this,value);
      }});
    })()`});
    try{
      await control({reset:true,hold:true,precompute:true,early:true,assetDelay:0,apiDelay:0,facetDelay:200,filterSettings:[{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Brand',config:{}}],globalSettings:{showFilterOptionsWithOneItem:true}});
      await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25 && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      const timings=await evaluate('filterScheduling');
      assert.ok(timings.renders.length>=2);assert.equal(timings.requests.length,1);
      // An independent head loader may have already rendered a small prefix.
      // The full filter request must precede the widget's card render.
      assert.ok(timings.renders.some(render=>render.at>timings.requests[0]&&render.filters===0),'Filter request waited for product rendering: '+JSON.stringify(timings));
      assert.ok(timings.renders.at(-1).filters>0,'Complete filters waited for grid replacement');
      assert.deepEqual(await evaluate('browserErrors'),[]);return timings;
    }finally{await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:hook.identifier});}
  });
  await test('a delayed head loader adopts body-started cards before the full widget arrives',async()=>{
    await control({reset:true,hold:true,precompute:true,headRenderer:true,early:true,headDelay:700,assetDelay:3500,apiDelay:100,cssDelay:0,facetDelay:0});
    await send('Network.clearBrowserCache');await send('Page.navigate',{url:origin+'/collections/fixture'});
    await wait("document.querySelectorAll('.cfp-initial-product').length>=5");
    const snapshot=await evaluate("({at:performance.now(),widget:!!window._cfpInitStarted,delivered:window._cfpRankedEarlyFetch.delivered})");
    assert.equal(snapshot.widget,false);assert.equal(snapshot.delivered,true);
    if(!redisLayer)assert.ok(snapshot.at<2000,'Body adoption waited for widget: '+snapshot.at);
    assert.equal((await getState()).requests.length,1);assert.deepEqual(await evaluate('browserErrors'),[]);
    await control({headDelay:0,headRenderer:false,early:false,assetDelay:0,apiDelay:0,hold:false});
    return {titlesMs:Math.round(snapshot.at),headDelayMs:700,widgetDelayMs:3500,liveTiming:false};
  });
  await test('head startup renders before DOMContentLoaded and late pricing/wishlist dependencies remain functional',async()=>{
    await control({reset:true,hold:true,precompute:true,headRenderer:true,early:true,priceDelay:2500,themeDelay:3500,htmlDelay:500,assetDelay:150,apiDelay:250,cssDelay:0,wishlist:true});
    await send('Network.clearBrowserCache');await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const at=await evaluate('cardSnapshots[0].at');assert.ok(at<2000,'Head fixture exceeded target: '+at);
    assert.equal(await evaluate("performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd"),0);
    assert.equal(await evaluate("document.querySelector('.cfp-product-card__price').textContent"),'See product price');
    const first=await cards();await wait("performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd>0");
    await wait("document.querySelector('.cfp-product-card__price').textContent!=='See product price'");
    await wait("document.querySelectorAll('.cfp-product-card .wishlist-toggle-btn').length===25");
    assert.ok(await evaluate("!!window.pageDataMap['dress-1']"));assert.deepEqual(await cards(),first);
    const data=await getState();assert.equal(data.requests.length,1);assert.equal(data.state.builds,1);assert.equal(data.facetResponses.length,1);assert.deepEqual(await evaluate('browserErrors'),[]);
    const domReadyMs=await evaluate("performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd");
    await control({hold:false,headRenderer:false,themeDelay:0,htmlDelay:0,assetDelay:0,apiDelay:0,wishlist:false});
    return {cardsMs:Math.round(at),domReadyMs:Math.round(domReadyMs),themeScriptDelayMs:3500,htmlDelayMs:500,twoSecondTargetMet:at<2000,liveTiming:false};
  });
  await test('a repeat page uses the prepared cache without another build',async()=>{
    // Keep both visits under the same settings; the preceding dependency test
    // switches wishlist integration off, which correctly changes the ranking key.
    await control({reset:true,precompute:true,early:false,assetDelay:0,apiDelay:0,clockOffset:0});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",8000);
    const start=Date.now();await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",8000);
    const data=await getState();assert.equal(data.state.builds,1);return {browserReadyMs:Date.now()-start,builds:data.state.builds};
  });
  await test('same-tab browser result appears on reload before a delayed fresh collection response',async()=>{
    await control({reset:true,productCount:80,precompute:true,hold:true,cardSnapshots:true,publishedPages:true,publishFirst50:true,headRenderer:true,early:true,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await wait("Object.keys(sessionStorage).some(key=>key.startsWith('cfp:collection-result:v1:'))");
    const first=await cards();
    await control({apiDelay:4000});
    await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')",2500);
    assert.deepEqual(await cards(),first);
    assert.equal(await evaluate("!!document.querySelector('#cfp-load-more-btn')"),true);
    assert.equal(await evaluate("performance.getEntriesByType('resource').some(entry=>entry.name.includes('/api/filter')&&entry.responseEnd>0)"),false);
    await evaluate("document.querySelector('#cfp-load-more-btn').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===50",10000);
    assert.equal(new Set(await cards()).size,50);
    await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')",10000);
    assert.deepEqual((await cards()).slice(0,25),first);
    assert.equal(await evaluate("!!document.querySelector('#cfp-load-more-btn')"),true);
    await control({archive:'1',invalidate:true,hold:false,delay:0,apiDelay:1000});
    await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')",2500);
    assert.equal((await cards()).includes('1'),true,'Recent cards should appear while the changed collection is checked');
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&![...document.querySelectorAll('.cfp-product-card--reveal')].some(card=>card.querySelector('a')?.href.includes('/dress-1'))",15000);
    assert.equal((await cards()).includes('1'),false,'Fresh stock and membership must replace the browser copy');
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {cachedCards:25,serverDelayMs:4000,loadMoreImmediately:true,changedProductRemoved:true};
  });
  let oldToken,oldIds;
  await test('load more keeps token order without duplicate products and puts zero-price product last',async()=>{
    oldToken=fixture.latestRankingToken();
    assert.equal(await evaluate("new URL(location.href).searchParams.has('rankingToken')"),false);
    await evaluate("document.querySelector('#cfp-load-more-btn').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal').length===30");
    oldIds=await cards();assert.equal(new Set(oldIds).size,30);assert.equal(oldIds.at(-1),'3');
    const data=await getState();assert.ok(data.requests.some(r=>r.page==='2'&&r.token===oldToken&&r.status===200));return {products:oldIds.length,zeroPriceLast:oldIds.at(-1)};
  });
  await test('pin/rule changes affect a new visit while an existing page-two token stays consistent',async()=>{
    await control({invalidate:true,pin:'4',boost:'5',delay:1800,priceDelay:50,imageDelay:50});
    await navigate('?page=2&rankingToken='+encodeURIComponent(oldToken));await wait("document.querySelectorAll('.cfp-product-card--reveal').length===5");
    assert.deepEqual(await cards(),oldIds.slice(25));
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",15000);assert.deepEqual((await cards()).slice(0,2),['4','5']);
    return {newFirstProducts:(await cards()).slice(0,2),oldPageTwoPreserved:true};
  });
  await test('changing sort cancels pending polling and cannot overwrite the newer cached result',async()=>{
    await control({hold:true});await evaluate("document.querySelector('[data-value=\"price-ascending\"]').click()");
    await wait("document.querySelectorAll('.cfp-skeleton-card').length===8");
    // Skeletons render before the asynchronous request reaches the server.
    await wait("(async()=>{const data=await(await fetch('/__state')).json();return data.requestStarts.some(r=>r.sort==='price-ascending');})()");
    await evaluate("document.querySelector('[data-value=\"best-selling\"]').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const before=(await getState()).requestStarts.filter(r=>r.sort==='price-ascending').length;
    assert.equal(before,1);
    await delay(2200);const after=(await getState()).requestStarts.filter(r=>r.sort==='price-ascending').length;
    assert.equal(after,before);assert.deepEqual((await cards()).slice(0,2),['4','5']);assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('mega menu paints above the sticky filter toolbar',async()=>{
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+2'),'Desktop viewport overflow');
    await evaluate("scrollTo(0,500);document.querySelector('#menu-open').click()");await delay(250);
    const result=await evaluate(`(()=>{const r=document.querySelector('#cfp-top-bar').getBoundingClientRect();const hit=document.elementFromPoint(150,r.top+10);return {headerWins:!!hit?.closest('#mega-menu'),toolbarZ:getComputedStyle(document.querySelector('#cfp-top-bar')).zIndex,headerZ:getComputedStyle(document.querySelector('header')).zIndex}})()`);
    assert.equal(result.headerWins,true);const image=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile('scratch/collection-headless-menu.png',Buffer.from(image.data,'base64'));return result;
  });
  await test('reduced-motion preferences disable the reveal animation',async()=>{
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await control({hold:false});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.cfp-product-card--reveal')).animationName"),'none');
  });
  await test('mobile collection cards fit the viewport and filter drawer can open and close',async()=>{
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:667,deviceScaleFactor:1,mobile:true});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+2'));
    await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open')"),true);
    const footer=await evaluate("(()=>{const button=document.querySelector('#cfp-apply-btn');const rect=button.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,height:rect.height,viewport:visualViewport.height,visible:getComputedStyle(button).visibility}})()");
    assert.equal(footer.visible,'visible');assert.ok(footer.height>0,JSON.stringify(footer));assert.ok(footer.bottom<=footer.viewport-12,'View all results must clear the mobile viewport bottom');
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:744,deviceScaleFactor:1,mobile:true});
    await wait("Math.abs(document.querySelector('#cfp-sidebar').getBoundingClientRect().height-visualViewport.height)<1");
    const expanded=await evaluate("(()=>{const drawer=document.querySelector('#cfp-sidebar').getBoundingClientRect(),button=document.querySelector('#cfp-apply-btn').getBoundingClientRect();return {drawerBottom:drawer.bottom,buttonBottom:button.bottom,viewport:visualViewport.height}})()");
    assert.ok(expanded.drawerBottom<=expanded.viewport+1 && expanded.buttonBottom<=expanded.viewport-12,JSON.stringify(expanded));
    await evaluate("document.querySelector('#cfp-close-btn').click()");assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open')"),false);
    const image=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile('scratch/collection-headless-mobile.png',Buffer.from(image.data,'base64'));
  });
  await test('unavailable preparation keeps retrying past thirty seconds and then renders products',async()=>{
    await control({reset:true,hold:true,noPins:true});await navigate();
    await wait("document.querySelectorAll('.cfp-skeleton-card').length>0");
    await delay(32000);
    assert.equal((await cards()).length,0);assert.equal(await evaluate('!!document.querySelector(".cfp-order-error")'),false);
    const before=(await getState()).requests.length;assert.ok(before>31,before);
    await control({invalidate:true,hold:false,delay:100});
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",15000);
    return {requestsBeforeReady:before,recoveredAutomatically:true};
  });
  await test('continuous unrelated product updates do not restart a native collection without external candidates',async()=>{
    await control({reset:true,delay:1500,stormCollection:'2',noPins:true});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",15000);
    await delay(1700);await control({stopStorm:true});
    const data=await getState();assert.equal(data.state.builds,1);assert.equal(data.productRevision,'0');assert.deepEqual(data.queueFailures,[]);
    return {builds:data.state.builds,unrelatedUpdatesDidNotInvalidate:true};
  });
  await test('continuous relevant updates do not starve a cold build or delete queue metadata',async()=>{
    await control({reset:true,delay:1500,stormCollection:'1'});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",15000);await control({stopStorm:true});
    const data=await getState();assert.ok(Number(data.productRevision)>0);assert.deepEqual(data.queueFailures,[]);assert.equal((await cards()).length,25);
    return {productUpdatesDuringBuild:Number(data.productRevision),cardsLoaded:true,unknownJobErrors:0};
  });
  await test('corrupt Redis preparation rebuilds and renders a fresh collection',async()=>{
    await control({reset:true,delay:100});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    await control({corruptPrepared:true});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const data=await getState();assert.equal(data.state.builds,2);assert.deepEqual(data.queueFailures,[]);
  });
  await test('expired page-two token automatically restarts once from page one',async()=>{
    const token=fixture.latestRankingToken();await control({expireTokens:true});
    await navigate('?page=2&rankingToken='+encodeURIComponent(token));await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    assert.ok([null,'1'].includes(await evaluate("new URL(location.href).searchParams.get('page')")));
    const data=await getState();assert.equal(data.requests.filter(r=>r.status===409).length,1);
  });
  for(const action of ['archive','deleteProduct'])await test(action+' of a cached first-page product rebuilds instead of repeated broken tokens',async()=>{
    await control({reset:true,delay:100});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    await control({[action]:'30'});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    assert.ok(!(await cards()).includes('30'));
    const data=await getState();assert.equal(data.state.builds,2);assert.equal(data.requests.filter(r=>r.status===409).length,1);
  });
  for(const failure of ['html','empty'])await test('invalid '+failure+' API response shows Retry and recovers',async()=>{
    await control({reset:true,apiFailure:failure});await navigate();await wait("!!document.querySelector('.cfp-order-error button')");assert.equal((await cards()).length,0);
    await control({apiFailure:null});await evaluate("document.querySelector('.cfp-order-error button').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('one temporary upstream failure retries without blanking the collection',async()=>{
    await control({reset:true,apiFailure:'once',delay:100});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    assert.equal(await evaluate("!!document.querySelector('.cfp-order-error')"),false);
    assert.equal((await getState()).state.apiFailure,null);
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('network loss during a price sort does not show products in the old order',async()=>{
    await control({reset:true,delay:100});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await evaluate("document.querySelector('[data-value=\"price-ascending\"]').click()");await wait("!!document.querySelector('.cfp-order-error button')");
    assert.equal((await cards()).length,0,'old-order products remained visible during price sort');
    await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await evaluate("document.querySelector('.cfp-order-error button').click()");
    await wait("!!document.querySelector('.cfp-order-error button')");
    assert.equal((await cards()).length,0,'unverified market prices displayed an old order');
    assert.ok((await getState()).requests.some(request=>request.profile==='fast-cards-v1'));
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('failed filter request keeps prior products and Retry applies the filter',async()=>{
    const filterSettings=[{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Designer',config:{}}];
    await control({reset:true,delay:100,filterSettings,globalSettings:{desktopFilterLayout:'drawer',showFilterOptionsWithOneItem:true}});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const previous=await cards();
    await control({apiFailure:'html',apiDelay:800});
    await evaluate("const input=document.querySelector('input[name=vendor]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));");
    await wait("document.querySelectorAll('#cfp-products-container .cfp-skeleton-card').length===25");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.cfp-skeleton-image')).animationName"),'cfpSkeletonGlassShimmer');
    assert.equal(await evaluate("document.querySelector('#cfp-products-container').classList.contains('cfp-loading-retained')"),true);
    await wait("!!document.querySelector('.cfp-order-error button')");
    assert.equal(await evaluate("document.querySelectorAll('#cfp-products-container .cfp-skeleton-card').length"),0);
    assert.deepEqual(await cards(),previous);
    assert.equal(await evaluate("document.querySelector('.cfp-order-error p').textContent.includes('Previous results are still shown')"),true);
    await control({apiFailure:null,apiDelay:0});
    await evaluate("document.querySelector('.cfp-order-error button').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25 && !document.querySelector('.cfp-order-error')");
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('filtered collection shows cards before slow facets finish',async()=>{
    const filterSettings=[{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Designer',config:{}}];
    await control({reset:true,delay:100,facetDelay:1800,filterSettings,globalSettings:{desktopFilterLayout:'drawer',showFilterOptionsWithOneItem:true}});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    await wait("document.querySelector('#cfp-sidebar input[name=vendor]')");
    await control({apiDelay:800});
    const before=await getState();
    await evaluate("const input=document.querySelector('input[name=vendor]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));");
    await wait("document.querySelectorAll('#cfp-products-container .cfp-skeleton-card').length===25");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.cfp-skeleton-image')).animationName"),'cfpSkeletonGlassShimmer');
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&document.querySelectorAll('.cfp-product-card--preview').length>0");
    assert.equal(await evaluate("document.querySelectorAll('.cfp-product-card__price-row').length"),25);
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25 && !document.querySelector('#cfp-sidebar.cfp-loading')");
    assert.equal(await evaluate("document.querySelectorAll('#cfp-products-container .cfp-skeleton-card').length"),0);
    assert.equal(await evaluate("document.querySelectorAll('.cfp-product-card__price-row').length"),25,'filtered cards must include price rows');
    assert.equal(await evaluate("document.querySelectorAll('.cfp-product-swatches').length"),25,'filtered cards must include variant swatches');
    assert.equal(await evaluate("[...document.querySelectorAll('.cfp-product-card__link')].some(link=>link.href.includes('variant='))"),true);
    await wait("[...document.querySelectorAll('.cfp-product-card__price')].some(price=>price.textContent.includes('$'))");
    const after=await getState(),requests=after.allRequests.slice(before.allRequests.length);
    assert.equal(requests.filter(request=>request.status===200&&request.profile==='fast-cards-v1').length,1,JSON.stringify(requests));
    assert.equal(requests.filter(request=>request.status===200&&request.profile==='collection-facets-v1').length,1,JSON.stringify(requests));
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('variant-dependent merchandising preserves global order and selected images across small batches',async()=>{
    await control({reset:true,colorRule:true,delay:100});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    assert.deepEqual((await cards()).slice(0,2),['1','30']);
    assert.ok(await evaluate("document.querySelector('.cfp-product-card--reveal img').src.includes('/image/1.svg')"));
    const data=await getState();assert.equal(data.state.builds,1);assert.deepEqual(data.queueFailures,[]);assert.deepEqual(await evaluate('browserErrors'),[]);
    return {variantRuleAcrossBatches:true,firstProducts:(await cards()).slice(0,2)};
  });
  await test('early first-page request overlaps deferred asset loading without duplicate requests',async()=>{
    await control({reset:true,delay:10,clockOffset:0,early:false,assetDelay:0,apiDelay:0});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    await control({assetDelay:1000,apiDelay:700,early:false});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const before=await evaluate('cardSnapshots[0].at');const beforeIds=await cards();const stateBefore=await getState();
    await control({early:true});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const after=await evaluate('cardSnapshots[0].at');const stateAfter=await getState();
    assert.equal(stateAfter.requests.length-stateBefore.requests.length,1);assert.deepEqual(await cards(),beforeIds);assert.equal(stateAfter.state.builds,1);assert.ok(after<before-400,`Early request did not overlap latency: ${before} -> ${after}`);
    // Remote Redis tests include cross-region round trips from this workstation.
    // Record that end-to-end latency; only the controlled local fixture checks 2s.
    if(!redisLayer)assert.ok(after<2000,`Local fixture exceeded two-second target: ${after}`);assert.deepEqual(await evaluate('browserErrors'),[]);
    return {baselineCardsMs:Math.round(before),earlyCardsMs:Math.round(after),savedMs:Math.round(before-after),fixtureAssetDelayMs:1000,fixtureApiDelayMs:700,twoSecondTargetMet:after<2000,liveTiming:false};
  });
  await test('early first-page request starts before a slow stylesheet without changing products or duplicating requests',async()=>{
    await control({reset:true,early:true,earlyBeforeStyles:false,cssDelay:1000,assetDelay:0,apiDelay:700,delay:10});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const before=await evaluate('cardSnapshots[0].at');const ids=await cards();const old=await getState();
    await control({earlyBeforeStyles:true});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const after=await evaluate('cardSnapshots[0].at');const current=await getState();
    assert.deepEqual(await cards(),ids);assert.equal(current.requests.length-old.requests.length,1);
    assert.ok(after<before-350, 'CSS overlap did not improve timing: '+before+' -> '+after);
    assert.deepEqual(await evaluate('browserErrors'),[]);await control({cssDelay:0,earlyBeforeStyles:false});
    return {baselineCardsMs:Math.round(before),earlyCardsMs:Math.round(after),savedMs:Math.round(before-after),fixtureStylesheetDelayMs:1000,fixtureApiDelayMs:700,liveTiming:false};
  });
  await test('new visitor after eleven minutes receives last-good ranking while refresh waits',async()=>{
    const before=await getState();await control({clockOffset:660000,hold:true});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const after=await getState();const requests=after.requests.slice(before.requests.length);
    assert.equal(requests.length,1);assert.ok([200,304].includes(requests[0].status));assert.equal(after.state.builds,before.state.builds);if(!redisLayer)assert.ok(await evaluate('cardSnapshots[0].at<2000'));assert.deepEqual(await evaluate('browserErrors'),[]);
    return {cardsMs:Math.round(await evaluate('cardSnapshots[0].at')),simulatedIdleMs:660000,refreshWorkerPaused:true,liveTiming:false};
  });
  await test('a new Shopify order does not blank the first page while the replacement worker is paused',async()=>{
    await control({reset:true,clockOffset:0,orderVersion:0,early:true,earlyBeforeStyles:true,assetDelay:0,cssDelay:0,apiDelay:0,delay:50});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const previous=await cards();const before=await getState();
    await control({orderVersion:1,hold:true});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const after=await getState();const requests=after.requests.slice(before.requests.length);
    assert.deepEqual(await cards(),previous);assert.equal(requests.length,1);assert.ok([200,304].includes(requests[0].status));
    assert.equal(after.state.builds,before.state.builds);assert.deepEqual(await evaluate('browserErrors'),[]);
    return {cardsMs:Math.round(await evaluate('cardSnapshots[0].at')),refreshWorkerPaused:true,firstRequestStatus:requests[0].status,liveTiming:false};
  });
  await test('maintained facts return first-visit cards without waiting for the ranking worker',async()=>{
    await send('Network.clearBrowserCache');
    await control({reset:true,directFacts:true,colorRule:true,pin:'4',hold:true,delay:20000,clockOffset:0,orderVersion:0,early:false,earlyBeforeStyles:false,assetDelay:0,cssDelay:0,apiDelay:0});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",10000);
    const status=await getState();
    assert.equal(status.state.builds,0);
    assert.ok(status.trace.candidateBrowses>0);
    assert.equal(status.requests.filter(r=>r.status===202).length,0);
    assert.deepEqual((await cards()).slice(0,2),['4','30']);
    assert.ok((await evaluate('cardSnapshots[0].at'))<10000);
  });
  await test('catalog preparation completes before any visitor and the first visitor needs no build or pending response',async()=>{
    await send('Network.clearBrowserCache');
    const before=await control({reset:true,pin:'5',colorRule:true,directFacts:false,hold:true,precompute:true,clockOffset:0,orderVersion:0,early:false,earlyBeforeStyles:false,assetDelay:0,cssDelay:0,apiDelay:0});
    assert.equal(before.state.builds,1);assert.equal(before.requests.length,0);
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",10000);
    const after=await getState();assert.equal(after.state.builds,1);
    assert.equal(after.requests.length,1);assert.equal(after.requests[0].status,200);
    assert.deepEqual((await cards()).slice(0,2),['5','30']);
  });
  await test('unchanged ranking survives a configuration refresh with the worker paused and no new build',async()=>{
    await control({reset:true,pin:'6',colorRule:true,directFacts:false,hold:true,precompute:true,clockOffset:0,orderVersion:0,early:false,earlyBeforeStyles:false,assetDelay:0,cssDelay:0,apiDelay:0});
    await control({invalidate:true});await send('Network.clearBrowserCache');await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",10000);
    const after=await getState();assert.equal(after.state.builds,1);
    assert.equal(after.requests.filter(r=>r.status===202).length,0);assert.deepEqual((await cards()).slice(0,2),['6','30']);
  });
  await test('unchanged maintained ranking serves a fresh browser after two hours with the worker paused',async()=>{
    const before=await control({reset:true,pin:'7',colorRule:true,directFacts:false,hold:true,precompute:true,clockOffset:0,orderVersion:0,early:false,earlyBeforeStyles:false,assetDelay:0,cssDelay:0,apiDelay:0});
    assert.equal(before.state.builds,1);await control({clockOffset:7200000});
    await send('Network.clearBrowserCache');await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",10000);
    const after=await getState();assert.equal(after.state.builds,1);
    assert.equal(after.requests.length,1);assert.equal(after.requests[0].status,200);
    assert.deepEqual((await cards()).slice(0,2),['7','30']);assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('unrelated outside-product updates preserve saved pinned cards after two hours with the worker paused',async()=>{
    await control({reset:true,pin:'7',hold:true,precompute:true,cardSnapshots:true,clockOffset:0,orderVersion:0,early:true,earlyBeforeStyles:true,assetDelay:0,apiDelay:0,cssDelay:0});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const first=await cards(),before=await getState();await control({clockOffset:7200000,unrelatedExternalUpdate:true});
    await send('Network.clearBrowserCache');await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
    const after=await getState();assert.equal(after.state.builds,before.state.builds);
    assert.equal(after.requests.slice(before.requests.length).some(r=>r.status===202),false);assert.deepEqual(await cards(),first);
    assert.equal(await evaluate('cardSnapshots[0].cards'),25);
    await control({clockOffset:0,early:false,earlyBeforeStyles:false,cardSnapshots:false});
  });
  // Run the intentionally slow same-origin image/price stress case last so
  // its outstanding HTTP/1 resource queue cannot skew later timing fixtures.
  await test('cold pending ranking keeps skeletons without a slow-loading warning, then renders cards images and prices',async()=>{
    await control({reset:true,noPins:true,colorRule:false,orderVersion:0,delay:5500,priceDelay:2500,imageDelay:3000});await navigate();
    await wait("document.querySelectorAll('.cfp-skeleton-card').length===8");assert.equal((await cards()).length,0);
    await delay(4200);assert.equal(await evaluate("!!document.querySelector('.cfp-loading-notice')"),false);assert.equal((await cards()).length,0);
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",15000);
    const snapshot=await evaluate('cardSnapshots[0]');assert.equal(snapshot.imagesLoaded,0);assert.equal(snapshot.pricesReady,0);
    assert.deepEqual(snapshot.delays,Array(Math.min(snapshot.cards,6)).fill('0s'));
    assert.equal(await evaluate('!!document.querySelector(".cfp-loading-notice")'),false);
    assert.equal(new Set(await cards()).size,25);
    await wait("document.querySelector('.cfp-product-card--reveal .cfp-product-card__price').textContent!=='See product price'",15000);
    await wait("document.querySelector('.cfp-product-card--reveal img').naturalWidth>0",15000);
    assert.deepEqual(await evaluate('browserErrors'),[]);return snapshot;
  });
  // Keep intentionally unfinished image/widget downloads last, so they cannot
  // occupy the browser's connection pool during other timing/cancellation checks.
  await test('pending products become visible before the delayed full widget without waiting for prices or images',async()=>{
    await control({reset:true,noPins:true,hold:false,headRenderer:true,early:true,delay:150,assetDelay:4500,apiDelay:50,cssDelay:0,facetDelay:0,priceDelay:2500,imageDelay:2500});
    await send('Network.clearBrowserCache');await send('Page.navigate',{url:origin+'/collections/fixture'});
    await wait("document.querySelectorAll('.cfp-initial-product').length>=5");
    const snapshot=await evaluate("({at:performance.now(),widget:!!window._cfpInitStarted,cards:[...document.querySelectorAll('.cfp-initial-product')].map(c=>({title:c.querySelector('h3').textContent,href:c.querySelector('a').getAttribute('href'),loaded:c.querySelector('img').complete&&c.querySelector('img').naturalWidth>0}))})");
    assert.equal(snapshot.widget,false);assert.ok(snapshot.cards.every(c=>c.title&&c.href.includes('/products/')));
    assert.ok(snapshot.cards.some(c=>!c.loaded),'Titles should not wait for slow images');
    if(!redisLayer)assert.ok(snapshot.at<2000,'Pending-to-ready fixture exceeded target: '+snapshot.at);
    const data=await getState();assert.ok(data.requests.some(r=>r.status===202));assert.ok(data.requests.some(r=>r.status===200));
    assert.deepEqual(await evaluate('browserErrors'),[]);
    await control({headRenderer:false,early:false,assetDelay:0,apiDelay:0,priceDelay:50,imageDelay:50});
    return {titlesMs:Math.round(snapshot.at),widgetDelayMs:4500,imageDelayMs:2500,liveTiming:false};
  });
  await test('each streamed card renders before later cards finish transferring and retains its DOM identity',async()=>{
    await control({reset:true,hold:true,precompute:true,headRenderer:true,early:true,assetDelay:8000,headDelay:0,apiDelay:50,cssDelay:0,streamDelay:160,imageDelay:50});
    await send('Network.clearBrowserCache');await send('Page.navigate',{url:origin+'/collections/fixture'});
    await wait("document.querySelectorAll('.cfp-initial-product').length>0");
    const first=await evaluate("(()=>{window.firstStreamCard=document.querySelector('.cfp-initial-product');return {at:performance.now(),count:document.querySelectorAll('.cfp-initial-product').length,placeholders:document.querySelectorAll('.cfp-first-row-placeholder').length,title:firstStreamCard.textContent,widget:!!window._cfpInitStarted}})()");
    assert.ok(first.count<25);assert.ok(first.title);assert.equal(first.widget,false);
    assert.equal(first.count+first.placeholders,25,'streamed cards must keep the unfinished page slots visible');
    const count=await evaluate("window._cfpRankedEarlyFetch.promise.then(r=>r.payload.products.length)");assert.equal(count,25);
    await wait("document.querySelectorAll('.cfp-initial-product').length===25");
    assert.equal(await evaluate("firstStreamCard===document.querySelector('.cfp-initial-product')"),true);
    const state=await getState();assert.equal(state.requests.length,1);assert.deepEqual(await evaluate('browserErrors'),[]);
    await control({streamDelay:0,assetDelay:0,headRenderer:false,early:false,hold:false});
    return {firstCardMs:Math.round(first.at),cardsAtFirstPaint:first.count,artificialTailDelayMs:160,liveTiming:false};
  });
  await test('a cold all-pin head renders with the ranking worker paused and hands off to canonical pagination',async()=>{
    await control({reset:true,hold:true,pinList:['1','2','4','5','6','7'],early:true,headRenderer:true,assetDelay:1500,apiDelay:50,cssDelay:0,imageDelay:50,priceDelay:50});
    await send('Network.clearBrowserCache');await send('Page.navigate',{url:origin+'/collections/fixture'});
    await wait("document.querySelectorAll('.cfp-initial-product').length===6");
    assert.equal(await evaluate("document.querySelectorAll('.cfp-first-row-placeholder').length"),19,'the early pin row must show the unfinished page slots');
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===6");
    assert.equal(await evaluate("document.querySelectorAll('#cfp-products-container .cfp-skeleton-card').length"),19,'the widget must keep the remaining page slots loading');
    const prefix=await cards(),at=await evaluate('cardSnapshots[0].at');
    assert.deepEqual(prefix,['1','2','4','5','6','7']);
    assert.equal((await getState()).state.builds,0);assert.equal(await evaluate("new URL(location.href).searchParams.has('rankingToken')"),false);
    assert.equal(await evaluate("!!document.querySelector('#cfp-load-more-btn')"),false);
    assert.equal(await evaluate("document.querySelector('.cfp-product-count').textContent"),'');
    await fixture.prepareLast();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.equal(await evaluate("document.querySelectorAll('#cfp-products-container .cfp-skeleton-card').length"),0);
    assert.deepEqual((await cards()).slice(0,prefix.length),prefix);assert.equal(await evaluate("new URL(location.href).searchParams.has('rankingToken')"),false);assert.ok(fixture.latestRankingToken());
    await evaluate("document.querySelector('#cfp-load-more-btn').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal').length===30");
    const all=await cards();assert.equal(new Set(all).size,30);assert.equal(all.at(-1),'3');
    const state=await getState();assert.ok(state.headEvents.some(e=>e.event==='head-comparison-match'));assert.ok(!state.headEvents.some(e=>e.event==='head-comparison-mismatch'));assert.deepEqual(await evaluate('browserErrors'),[]);
    return {coldPrefixMs:Math.round(at),fullRankingPausedAtPrefix:true,cardsAtPrefix:6,canonicalPaginationProducts:all.length,liveTiming:false};
  });
  await test('forty pins show 25 complete cards first and Load more keeps the remaining fifteen in order',async()=>{
    const pins=Array.from({length:41},(_,i)=>String(i+1)).filter(id=>id!=='3');
    await control({reset:true,hold:true,productCount:70,pinList:pins,early:true,headRenderer:true,assetDelay:0,apiDelay:0,cssDelay:0,imageDelay:0,priceDelay:0});
    await send('Network.clearBrowserCache');await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.deepEqual(await cards(),pins.slice(0,25));assert.equal((await getState()).state.builds,0);
    assert.equal(await evaluate("document.querySelectorAll('.cfp-product-card--preview').length"),0);
    await wait("[...document.querySelectorAll('.cfp-product-card__price')].slice(0,5).every(p=>/[0-9]/.test(p.textContent))");
    await evaluate("window.firstPinnedCard=document.querySelector('.cfp-product-card--reveal');window.firstPinnedPrice=firstPinnedCard.querySelector('.cfp-product-card__price').textContent");
    assert.equal(await evaluate("!!document.querySelector('#cfp-load-more-btn')"),false);
    await fixture.prepareLast();await wait("!!document.querySelector('#cfp-load-more-btn')");
    assert.equal((await cards()).length,25);
    assert.equal(await evaluate("firstPinnedCard===document.querySelector('.cfp-product-card--reveal')"),true);
    assert.equal(await evaluate("firstPinnedCard.querySelector('.cfp-product-card__price').textContent===firstPinnedPrice"),true);
    assert.equal(await evaluate("document.querySelector('.cfp-product-count').textContent"),'70 products');
    assert.equal((await getState()).allRequests.filter(r=>r.page==='2').length,0);
    await evaluate("document.querySelector('#cfp-load-more-btn').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===50");
    assert.deepEqual((await cards()).slice(0,40),pins);
    await evaluate("document.querySelector('#cfp-load-more-btn').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===70");
    const all=await cards();assert.equal(new Set(all).size,70);assert.equal(all.at(-1),'3');
    const state=await getState();assert.ok(state.headEvents.some(e=>e.event==='head-comparison-match'));assert.deepEqual(await evaluate('browserErrors'),[]);
    return {initialCards:25,pinsAcrossFirstTwoPages:40,canonicalProducts:70,fullRankingPausedAtPins:true,liveTiming:false};
  });
  for(const exhausted of [false,true])await test(`an empty Load more response preserves existing cards (exhausted=${exhausted})`,async()=>{
    await control({reset:true,productCount:30,precompute:true,early:false,assetDelay:0,apiDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const original=await cards();
    await evaluate(`(()=>{window.retainedFirstCard=document.querySelector('.cfp-product-card');const original=window.fetch;let changed=false;window.fetch=async function(input,options){const response=await original.call(this,input,options);const url=new URL(typeof input==='string'?input:input.url,location.origin);if(!changed&&url.pathname==='/api/filter'&&url.searchParams.get('page')==='2'){changed=true;const payload=await response.json();payload.products=[];payload.totalCount=${exhausted?25:30};return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});}return response;};document.querySelector('#cfp-load-more-btn').click();})()`);
    if(exhausted)await wait("!document.querySelector('#cfp-load-more-btn')&&!new URL(location.href).searchParams.has('page')");
    else await wait("!!document.querySelector('.cfp-order-error button')");
    assert.deepEqual(await cards(),original);assert.equal(await evaluate("retainedFirstCard===document.querySelector('.cfp-product-card')"),true);
    assert.equal(await evaluate("!!document.querySelector('.cfp-no-products')"),false);
    assert.equal(await evaluate("!!document.querySelector('#cfp-load-more-btn')"),false);
    if(!exhausted){
      await evaluate("document.querySelector('.cfp-order-error button').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal').length===30");
      assert.deepEqual((await cards()).slice(0,25),original);assert.equal(new Set(await cards()).size,30);
      assert.equal((await getState()).allRequests.filter(r=>r.page==='2').length,2);
    }
    assert.deepEqual(await evaluate('browserErrors'),[]);return {retainedCards:25,retriedSamePage:!exhausted};
  });
  await test('a Load more rendering failure offers a working retry without an unhandled rejection',async()=>{
    await control({reset:true,productCount:30,precompute:true,early:false,assetDelay:0,apiDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const original=await cards();
    await evaluate("(()=>{const grid=document.querySelector('#cfp-products-container');const insert=grid.insertAdjacentHTML;grid.insertAdjacentHTML=function(...args){this.insertAdjacentHTML=insert;throw Error('Injected card insertion failure');};document.querySelector('#cfp-load-more-btn').click();})()");
    await wait("!!document.querySelector('.cfp-order-error button')");assert.deepEqual(await cards(),original);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    await evaluate("document.querySelector('.cfp-order-error button').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal').length===30");
    assert.deepEqual((await cards()).slice(0,25),original);assert.equal(new Set(await cards()).size,30);assert.deepEqual(await evaluate('browserErrors'),[]);
    return {retryRecovered:true,unhandledRejections:0};
  });
  await test('catalog text stays literal and swatch image URLs containing quotes remain clickable',async()=>{
    await control({reset:true,productCount:30,precompute:true,early:false,assetDelay:0,apiDelay:0,priceDelay:0,imageDelay:0});
    const title='<em>Dress "Blue" & \'Silk\'</em>',vendor='<b>Vendor & Co</b>',color='Ocean "Blue" <b> & \'Sea\'';
    const injection=await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const original=window.fetch;window.fetch=async function(input,options){const response=await original.call(this,input,options);const url=new URL(typeof input==='string'?input:input.url,location.origin);if(url.pathname==='/api/filter'&&url.searchParams.get('page')==='1'&&url.searchParams.get('responseProfile')!=='collection-config-v1'&&response.status===200){const payload=await response.json();if(payload.products?.length){const product=payload.products[0];product.title=${JSON.stringify(title)};product.vendor=${JSON.stringify(vendor)};product.options=[{name:'Color',values:[${JSON.stringify(color)}]}];product.variants[0].option1=${JSON.stringify(color)};product.variants[0].imageUrl=location.origin+"/image/1.svg?shade=O'Reilly";return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});}}return response;};})()`});
    try{
      await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      assert.equal(await evaluate("document.querySelector('.cfp-product-card__title').textContent"),title);
      assert.equal(await evaluate("document.querySelector('.cfp-product-card__vendor').textContent"),vendor);
      assert.equal(await evaluate("document.querySelector('.cfp-product-card__image--primary').alt"),title);
      assert.equal(await evaluate("document.querySelector('.cfp-swatch-item').dataset.tooltip"),color);
      assert.equal(await evaluate("document.querySelector('.cfp-product-card__title em,.cfp-product-card__vendor b')===null"),true,'Catalog text must not create markup');
      await evaluate("document.querySelector('.cfp-swatch-item').click()");
      assert.equal(await evaluate("new URL(document.querySelector('.cfp-product-card__image--primary').src).searchParams.get('shade')"),"O'Reilly",'Swatch click must preserve the quoted image URL');
      assert.deepEqual(await evaluate('browserErrors'),[]);return {literalTitles:true,literalColorNames:true,swatchClickPassed:true};
    }finally{await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:injection.identifier});}
  });
  await test('short four-card collections do not reserve blank space above the footer',async()=>{
    for(const count of [4]){
      await control({reset:true,productCount:count,precompute:true,early:true,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
      await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      const result=await evaluate(`(()=>{const app=document.querySelector('.cfp-v1-app-container'),grid=document.getElementById('cfp-products-container');return {minimum:getComputedStyle(app).minHeight,height:app.getBoundingClientRect().height,gap:app.getBoundingClientRect().bottom-grid.getBoundingClientRect().bottom,cards:document.querySelectorAll('.cfp-product-card:not(.cfp-skeleton-card)').length};})()`);
      assert.equal(result.minimum,'0px');assert.equal(result.cards,count);
      assert.ok(result.gap<150,'Short collections should follow content height: '+JSON.stringify(result));
    }
    return {fourCards:true};
  });
  await test('two filter selections finish with the ranking worker paused using exact direct preparation',async()=>{
    const filterSettings=[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{}},{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Brand',config:{}}];
    await control({reset:true,productCount:30,precompute:true,hold:true,directFacts:true,early:true,filterSettings,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const before=await getState();
    for(const selector of ['input[name="option-Color"]','input[name="vendor"]']){
      await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify('#cfp-sidebar '+selector)});input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    }
    const after=await getState(),requests=after.allRequests.slice(before.allRequests.length);
    assert.equal(requests.length,2);assert.ok(requests.every(r=>r.status===200&&r.profile==='collection-v1'),JSON.stringify(requests));
    assert.equal(after.state.builds,before.state.builds);
    assert.equal(await evaluate("!!document.querySelector('.cfp-facet-error,.cfp-order-error')"),false);assert.deepEqual(await evaluate('browserErrors'),[]);
    return {filterSelections:2,pendingResponses:0,workerPaused:true,liveTiming:false};
  });
  await test('Blue then Size L narrows saved product IDs and keeps the collection order',async()=>{
    const filterSettings=[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{}},
      {id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',config:{}}];
    const productFields=Object.fromEntries(Array.from({length:30},(_,i)=>{
      const id=String(i+1),size=i%2===0?'L':'M';
      return [id,{options:[{name:'Color',values:['Blue']},{name:'Size',values:[size]}],
        variantPrices:[{id:String((i+1)*100),price:i+1,available:true,option1:'Blue',option2:size,imageUrl:`/image/${id}.svg`}]}];
    }));
    await control({reset:true,productCount:30,precompute:true,hold:true,directFacts:true,early:true,
      noPins:true,filterSettings,productFields,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const unfiltered=await getState();
    await evaluate("(()=>{const input=document.querySelector('#cfp-sidebar input[name=\"option-Color\"][value=\"Blue\"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const blue=await getState();
    assert.equal(blue.trace.membershipBrowses-unfiltered.trace.membershipBrowses,1,'first Color filter should narrow the saved unfiltered ranking');
    assert.equal(blue.trace.candidateBrowses,unfiltered.trace.candidateBrowses,'first Color filter should avoid a full collection candidate browse');
    await control({apiDelay:350});
    await evaluate("(()=>{const input=document.querySelector('#cfp-sidebar input[name=\"option-Size\"][value=\"L\"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    const loading=await evaluate("(()=>{const grid=document.querySelector('#cfp-products-container'),card=grid.querySelector('.cfp-skeleton-card'),more=grid.querySelector('.cfp-load-more-container');return {skeletons:grid.querySelectorAll('.cfp-skeleton-card').length,offset:card?.getBoundingClientRect().top-grid.getBoundingClientRect().top,moreDisplay:more?getComputedStyle(more).display:null};})()");
    assert.equal(loading.skeletons,25);assert.ok(loading.offset<25,'skeleton should start in the first grid row: '+JSON.stringify(loading));
    assert.equal(loading.moreDisplay,'none');
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===15&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const after=await getState(),sizeCards=await cards();
    assert.equal(after.trace.membershipBrowses-blue.trace.membershipBrowses,1,'Size L should query only the Blue ID set');
    assert.equal(after.trace.candidateBrowses,blue.trace.candidateBrowses,'Size L should skip a full candidate browse');
    assert.ok(after.allRequests.slice(blue.allRequests.length).some(r=>r.profile==='fast-cards-v1'&&r.membershipParent&&r.status===200));
    assert.deepEqual(sizeCards,[...Array.from({length:13},(_,i)=>String(29-i*2)),'1','3']);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {blueResults:30,sizeResults:15,visible:15,membershipBrowses:1,workerPaused:true};
  });
  await test('first filter narrows a published complete collection without rebuilding candidates',async()=>{
    const filterSettings=[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{}}];
    await control({reset:true,productCount:60,precompute:true,hold:true,directFacts:true,cardSnapshots:true,publishedPages:true,publishFirst50:true,early:true,noPins:true,filterSettings,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const before=await getState();
    await evaluate("(()=>{const input=document.querySelector('#cfp-sidebar input[name=\"option-Color\"][value=\"Blue\"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const after=await getState();
    assert.equal(after.trace.membershipBrowses-before.trace.membershipBrowses,1);
    assert.equal(after.trace.candidateBrowses,before.trace.candidateBrowses);
    assert.ok(after.allRequests.slice(before.allRequests.length).some(r=>r.profile==='fast-cards-v1'&&r.membershipParent&&r.status===200));
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('legacy Color and Size groups use popularity and natural size order; explicit alphabetical stays available',async()=>{
    const sizes=['XL','XXS','2XL','S','10','2','10W','M'];
    const colors=['Blue','Red','Blue','Green','Red','Blue','Black','Orange'];
    const productFields=Object.fromEntries(sizes.map((size,i)=>[String(i+1),{
      options:[{name:'Color',values:[colors[i]]},{name:'Size',values:[size]}],
      variantPrices:[{id:String((i+1)*100),price:i+1,available:true,option1:colors[i],option2:size,imageUrl:`/image/${i+1}.svg`}],
    }]));
    const settings=[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'Swatch',config:{advanced:{sortType:'Label - AZ'}}},
      {id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',displayMode:'Box/Button',config:{advanced:{sortType:'Label - AZ'}}},
      {id:'vendor',isEnabled:true,filterType:'vendor',label:'Designers',displayMode:'List',config:{}}];
    await control({reset:true,productCount:8,precompute:true,early:true,noPins:true,noMerchandising:true,filterSettings:settings,
      globalSettings:{showProductCount:false},productFields,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const hoverCounts=await evaluate("({color:document.querySelector('#cfp-sidebar input[name=\"option-Color\"][value=\"Blue\"]')?.closest('label').title,size:document.querySelector('#cfp-sidebar input[name=\"option-Size\"][value=\"XXS\"]')?.closest('label').title,vendor:document.querySelector('#cfp-sidebar input[name=\"vendor\"][value=\"Fixture\"]')?.closest('label').title,printed:document.querySelectorAll('#cfp-sidebar .cfp-checkbox__count').length})");
    assert.deepEqual(hoverCounts,{color:'Blue (3)',size:'XXS (1)',vendor:'Fixture (8)',printed:0});
    const options=await evaluate("({color:[...document.querySelectorAll('#cfp-sidebar input[name=\"option-Color\"]')].map(e=>e.value),size:[...document.querySelectorAll('#cfp-sidebar input[name=\"option-Size\"]')].map(e=>e.value)})");
    assert.deepEqual(options.color.slice(0,2),['Blue','Red']);
    assert.deepEqual(options.size,['XXS','S','M','XL','2XL','2','10','10W']);
    await evaluate("(()=>{const input=document.querySelector('#cfp-sidebar input[name=\"option-Color\"][value=\"Blue\"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===3&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar input[name=\"vendor\"][value=\"Fixture\"]').closest('label').title"),'Fixture (3)');
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar input[name=\"option-Color\"][value=\"Blue\"]').closest('label').title"),'Blue (3)');
    settings[1].config.advanced.sortModeExplicit=true;
    await control({reset:true,productCount:8,precompute:true,early:true,noPins:true,noMerchandising:true,filterSettings:settings,
      globalSettings:{showProductCount:false},productFields,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#cfp-sidebar input[name=\"option-Size\"]')].map(e=>e.value)"),
      [...sizes].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})));
    return {automatic:true,explicitAlphabetical:true};
  });
  await test('rapid image selection and clearing remain accurate before delayed responses',async()=>{
    const fields=[['Length','Length:', ['Long','Short']],['Sleeve Type','Sleeve:', ['Long']],['Silhouette','Silhouette:', ['Long']]];
    const filterSettings=fields.map(([label,prefix,values],i)=>({id:'rapid-'+i,isEnabled:true,filterType:'tag',filterKey:null,label,displayMode:'Swatch',
      config:{prefix,multipleSelection:true,swatchConfig:{layout:'Grid',colors:Object.fromEntries(values.map(v=>[prefix+v,{type:'image',value:'/image/1.svg'}]))}}}));
    const productFields=Object.fromEntries(Array.from({length:8},(_,i)=>[String(i+1),{tags:['Length:Long','Length:Short','Sleeve:Long','Silhouette:Long']}]));
    await control({reset:true,productCount:8,precompute:true,noPins:true,noMerchandising:true,filterSettings,productFields,
      globalSettings:{showFilterOptionsWithOneItem:true,desktopFilterLayout:'drawer'},apiDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelector('#cfp-sidebar input[value=\"Length:Long\"]')&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    await control({apiDelay:2200});
    const immediate=await evaluate(`(()=>{
      const panel=document.getElementById('cfp-sidebar');document.getElementById('cfp-drawer-trigger-btn').click();
      const choose=value=>[...panel.querySelectorAll('input[name=tag]')].find(x=>x.value===value).closest('label').click();
      const state=()=>[...panel.querySelectorAll('input[name=tag]:checked')].map(x=>x.value).sort();
      choose('Length:Long');choose('Length:Short');choose('Sleeve:Long');choose('Silhouette:Long');
      const all=state();
      choose('Length:Short');const unchecked=[...panel.querySelectorAll('input[name=tag]')].find(x=>x.value==='Length:Short');
      const staleCheck=unchecked.closest('label').classList.contains('cfp-color-swatch--selected');
      const sleeve=[...panel.querySelectorAll('.cfp-group')].find(g=>g.querySelector('input[value="Sleeve:Long"]'));
      const clear=sleeve.querySelector('.cfp-clear-group');const clearAvailable=!!clear;clear?.click();
      return {all,staleCheck,clearAvailable,remaining:state(),query:location.search};
    })()`);
    assert.deepEqual(immediate.all,['Length:Long','Length:Short','Silhouette:Long','Sleeve:Long'].sort());
    assert.equal(immediate.staleCheck,false);assert.equal(immediate.clearAvailable,true);
    assert.deepEqual(immediate.remaining,['Length:Long','Silhouette:Long'].sort());
    await wait("!document.querySelector('#cfp-sidebar.cfp-loading')",20000);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#cfp-sidebar input[name=tag]:checked')].map(x=>x.value).sort()"),immediate.remaining);
    await evaluate("document.getElementById('cfp-clear-btn').click()");
    assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar input:checked').length"),0);
    assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar .cfp-color-swatch--selected').length"),0);
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('saved price checkboxes clear independently of image selections',async()=>{
    const filterSettings=[{id:'price',isEnabled:true,filterType:'price',label:'Price',displayMode:'List',config:{priceRanges:[{id:1,from:'0',to:'10',label:'{0} - {1}'},{id:2,from:'10',to:'',label:'From {0}'}]}},
      {id:'length',isEnabled:true,filterType:'tag',label:'Length',displayMode:'Swatch',config:{prefix:'Length:',swatchConfig:{colors:{'Length:Long':{type:'image',value:'/image/1.svg'}}}}}];
    const productFields=Object.fromEntries(Array.from({length:8},(_,i)=>[String(i+1),{tags:['Length:Long']}]));
    await control({reset:true,productCount:8,precompute:true,noPins:true,noMerchandising:true,filterSettings,productFields,
      globalSettings:{showFilterOptionsWithOneItem:true,desktopFilterLayout:'drawer'},apiDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelector('#cfp-sidebar input[name=price]')&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    await control({apiDelay:1200});
    await evaluate("document.querySelector('#cfp-sidebar input[name=tag]').closest('label').click();document.querySelector('#cfp-sidebar input[name=price]').closest('label').click()");
    assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar input:checked').length"),2);
    await evaluate("document.querySelector('#cfp-sidebar input[name=price]').closest('.cfp-group').querySelector('.cfp-clear-group').click()");
    assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar input[name=price]:checked').length"),0);
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar input[name=tag]').checked"),true);
    await wait("!document.querySelector('#cfp-sidebar.cfp-loading')",20000);
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar input[name=tag]').checked"),true);
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('single-select image replacement and horizontal popover preserve current selection',async()=>{
    const filterSettings=['Length','Sleeve'].map((label,i)=>({id:'single-'+i,isEnabled:true,filterType:'tag',filterKey:null,label,displayMode:'Swatch',
      config:{prefix:label+':',multipleSelection:false,swatchConfig:{layout:'Grid',colors:{[label+':Long']:{type:'image',value:'/image/1.svg'},[label+':Short']:{type:'image',value:'/image/1.svg'}}}}}));
    const productFields=Object.fromEntries(Array.from({length:8},(_,i)=>[String(i+1),{tags:['Length:Long','Length:Short','Sleeve:Long','Sleeve:Short']}]));
    await control({reset:true,realToolbar:true,productCount:8,precompute:true,noPins:true,noMerchandising:true,filterSettings,productFields,
      globalSettings:{showFilterOptionsWithOneItem:true,desktopFilterLayout:'horizontal'},apiDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelector('#cfp-horizontal-filters .cfp-horizontal-pill__btn')&&!document.querySelector('#cfp-sidebar.cfp-loading')");
    await evaluate("document.querySelector('#cfp-horizontal-filters .cfp-horizontal-pill__btn').click();document.querySelector('#cfp-h-pop-single-0-tag- input[value=\"Length:Long\"]').closest('label').click()");
    await wait("!document.querySelector('#cfp-sidebar.cfp-loading')");
    await control({apiDelay:1800});
    const state=await evaluate(`(()=>{const roots=document.getElementById('cfp-horizontal-filters');
      const choose=value=>[...roots.querySelectorAll('input')].find(x=>x.value===value).closest('label').click();
      choose('Length:Short');const old=roots.querySelector('input[value="Length:Long"]');
      const stale=old.checked||old.closest('label').classList.contains('cfp-color-swatch--selected');
      const sleeve=roots.querySelector('#cfp-h-pop-single-1-tag-');sleeve.previousElementSibling.click();choose('Sleeve:Long');
      sleeve.querySelector('.cfp-clear-group').click();
      return {stale,selected:[...roots.querySelectorAll('input:checked')].map(x=>x.value),open:roots.querySelector('.cfp-horizontal-pill__popover.is-open')?.id};})()`);
    assert.equal(state.stale,false);assert.deepEqual(state.selected,['Length:Short']);
    assert.equal(state.open,'cfp-h-pop-single-1-tag-');
    await wait("!document.querySelector('#cfp-sidebar.cfp-loading')",20000);
    assert.equal(await evaluate("document.querySelector('.cfp-horizontal-pill__popover.is-open')?.id"),'cfp-h-pop-single-1-tag-');
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('clearing one image tag group preserves other selected image groups',async()=>{
    const groups=[['Sleeve Type','Sleeve:Long'],['Silhouette','Silhouette:Long'],['Neckline','Neckline:V']];
    const settings=groups.map(([label,value],index)=>({id:`image-${index}`,isEnabled:true,filterType:'tag',filterKey:label,label,displayMode:'Swatch',
      config:{prefix:value.split(':')[0]+':',multipleSelection:true,swatchConfig:{layout:'Grid',colors:{[value]:{type:'image',value:'/image/1.svg'}}}}}));
    const productFields=Object.fromEntries(Array.from({length:8},(_,index)=>[String(index+1),{tags:groups.map(([,value])=>value)}]));
    await control({reset:true,productCount:8,precompute:true,early:true,noPins:true,noMerchandising:true,filterSettings:settings,
      globalSettings:{showFilterOptionsWithOneItem:true,desktopFilterLayout:'drawer'},productFields,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await evaluate("document.getElementById('cfp-drawer-trigger-btn').click()");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#cfp-sidebar .cfp-color-grid--images')].map(grid=>getComputedStyle(grid).gridTemplateColumns.split(' ').length)"),[4,4,4]);
    await evaluate("document.getElementById('cfp-close-btn').click()");
    for(const [,value] of groups){
      await evaluate(`(()=>{const input=[...document.querySelectorAll('#cfp-sidebar input[name="tag"]')].find(e=>e.value===${JSON.stringify(value)});input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    }
    assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar input[name=tag]:checked').length"),3);
    const visual=await evaluate("(()=>{const label=document.querySelector('#cfp-sidebar input[name=tag]:checked').closest('label');const circle=label.querySelector('.cfp-swatch-circle');return {image:label.classList.contains('cfp-color-swatch--image'),selected:label.classList.contains('cfp-color-swatch--selected'),checked:label.querySelector('input').checked,selector:label.matches('.cfp-color-swatch--image.cfp-color-swatch--selected'),border:getComputedStyle(circle).borderTopWidth,check:getComputedStyle(circle,'::after').content};})()");
    assert.equal(visual.image,true);assert.equal(visual.border,'0px');assert.ok(visual.check.includes('✓'),JSON.stringify(visual));
    await evaluate("document.querySelector('#cfp-sidebar .cfp-group[data-group=\"tag-Sleeve Type\"] .cfp-clear-group').click()");
    await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('#cfp-sidebar input[name=tag]:checked')].map(e=>e.value).sort()"),
      ['Silhouette:Long','Neckline:V'].sort());
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('saved Color hover count excludes sold-out variants while cards stay ready',async()=>{
    const settings=[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',displayMode:'Swatch',config:{}}];
    const productFields={
      '1':{options:[{name:'Color',values:['Black','Blue']}],variantPrices:[{id:'100',price:10,available:false,option1:'Black',imageUrl:'/image/1.svg'},{id:'101',price:10,available:true,option1:'Blue',imageUrl:'/image/1.svg'}]},
      '2':{options:[{name:'Color',values:['Black']}],variantPrices:[{id:'200',price:20,available:true,option1:'Black',imageUrl:'/image/2.svg'}]},
      '3':{options:[{name:'Color',values:['Black']}],variantPrices:[{id:'300',price:30,available:true,option1:'Black',imageUrl:'/image/3.svg'}]},
    };
    await control({reset:true,productCount:3,precompute:true,cardSnapshots:true,publishedPages:true,publishFirst50:true,early:true,noPins:true,noMerchandising:true,
      filterSettings:settings,globalSettings:{hideUnavailableVariantsWhenSelected:true,showProductCount:false},productFields,
      apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar input[name=\"option-Color\"][value=\"Black\"]').closest('label').title"),'Black (2)');
    await evaluate("(()=>{const input=document.querySelector('#cfp-sidebar input[name=\"option-Color\"][value=\"Black\"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===2&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('zzqxv shows zero products and browseable collections',async()=>{
    await control({reset:true,productCount:30,noMatchQuery:'zzqxv',noPins:true,
      apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await send('Page.navigate',{url:origin+'/search?q=zzqxv'});
    await wait("!!document.querySelector('.cfp-no-products')&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await wait("document.querySelectorAll('.cfp-empty-collections a').length===2");
    const result=await evaluate("({message:document.querySelector('.cfp-no-products p')?.innerText,count:document.body.innerText.match(/0 products/i)?.[0],cards:document.querySelectorAll('.cfp-product-card--reveal').length,links:[...document.querySelectorAll('.cfp-empty-collections a')].map(e=>e.getAttribute('href'))})");
    assert.match(result.message,/zzqxv/);assert.equal(result.cards,0);
    assert.deepEqual(result.links,['/collections/formal-dresses','/collections/prom-dresses']);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return result;
  });
  await test('purple prom dress search applies Size L with one complete filter response',async()=>{
    const productFields=Object.fromEntries(Array.from({length:30},(_,i)=>{
      const id=String(i+1),size=i%2===0?'L':'M';
      return [id,{options:[{name:'Color',values:['Purple']},{name:'Size',values:[size]}],
        variantPrices:[{id:String((i+1)*100),price:i+1,available:true,option1:'Purple',option2:size,imageUrl:`/image/${id}.svg`}]}];
    }));
    const filterSettings=[{id:'size',isEnabled:true,filterType:'option',filterKey:'Size',label:'Size',config:{}}];
    await control({reset:true,productCount:30,productFields,filterSettings,searchFacetDelay:3000,
      globalSettings:{hideUnavailableVariantsWhenSelected:true},
      apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await send('Page.navigate',{url:origin+'/search?q=purple%20prom%20dress'});
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const initialCards=await cards(),initial=await getState();
    const firstCardsMs=await evaluate('window.cardSnapshots[0]?.at');
    assert.ok(firstCardsMs<2000,`first search cards took ${firstCardsMs}ms in the local delayed-facet fixture`);
    assert.equal(initial.allRequests.filter(r=>r.profile==='search-fast-cards-v1'&&r.query==='purple prom dress'&&r.status===200&&r.products===25).length,1);
    await wait("window._cfpInitialized&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    assert.deepEqual(await cards(),initialCards,'full search facets should preserve early card order');
    const beforeFilter=await getState();
    await evaluate("(()=>{const input=document.querySelector('#cfp-sidebar input[name=\"option-Size\"][value=\"L\"]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await evaluate("document.querySelector('#cfp-apply-btn').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===15&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    const filteredCards=await cards();
    const filtered=await getState(),requests=filtered.allRequests.slice(beforeFilter.allRequests.length);
    assert.equal(requests.filter(r=>r.status===200).length,1,JSON.stringify(requests));
    assert.equal(requests.filter(r=>r.status===200)[0].profile,null);
    assert.deepEqual(filteredCards,Array.from({length:15},(_,i)=>String(29-i*2)));
    assert.equal(await evaluate("!!document.querySelector('.cfp-facet-error,.cfp-order-error')"),false);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {query:'purple prom dress',firstCardsMs:Math.round(firstCardsMs),sizeResults:15,filterRequests:1};
  });
  await test('pinned cards keep the first variant from early display through full cards and shopper swatch changes',async()=>{
    const productVariants={'1':[{id:'100',option1:'Green',available:false,imageUrl:'/image/green.svg',price:10},{id:'101',option1:'Blue',available:true,imageUrl:'/image/blue.svg',price:20}]};
    await control({reset:true,productCount:30,precompute:true,hold:true,headRenderer:true,early:true,colorRule:true,pinList:['1'],productVariants,assetDelay:1600,apiDelay:0,imageDelay:0,priceDelay:0});
    await send('Network.clearBrowserCache');await send('Page.navigate',{url:origin+'/collections/fixture'});
    await wait("!!document.querySelector('.cfp-initial-product a')");
    assert.equal(await evaluate("new URL(document.querySelector('.cfp-initial-product a').href).searchParams.get('variant')"),'100');
    assert.ok((await evaluate("document.querySelector('.cfp-initial-product img').src")).includes('/image/1.svg'));
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    const first="document.querySelector('.cfp-product-card--reveal')";
    assert.equal(await evaluate(`new URL(${first}.querySelector('.cfp-product-card__link').href).searchParams.get('variant')`),'100');
    assert.equal(await evaluate(`${first}.querySelector('.cfp-swatch-active').dataset.tooltip`),'Green');
    assert.ok((await evaluate(`${first}.querySelector('.cfp-product-card__image--primary').src`)).includes('/image/1.svg'));
    await evaluate(`${first}.querySelector('[data-tooltip="Blue"]').click()`);
    assert.equal(await evaluate(`new URL(${first}.querySelector('.cfp-product-card__link').href).searchParams.get('variant')`),'101');
    assert.ok((await evaluate(`${first}.querySelector('.cfp-product-card__image--primary').src`)).includes('/image/blue.svg'));
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {defaultVariant:'100',firstVariantAvailable:false,shopperChoice:'101',liveTiming:false};
  });
  await test('early cards remain visible while the full widget shows skeletons and awaits the stream tail',async()=>{
    await control({reset:true,productCount:30,precompute:true,hold:true,headRenderer:true,early:true,streamDelay:180,assetDelay:1200,apiDelay:0,imageDelay:0,priceDelay:0});
    await send('Network.clearBrowserCache');await send('Page.navigate',{url:origin+'/collections/fixture'});
    await wait("document.querySelectorAll('.cfp-initial-product').length>0");
    await wait("document.querySelectorAll('#cfp-products-container .cfp-skeleton-card').length>0");
    await delay(200);
    assert.equal(await evaluate("[...document.querySelectorAll('.cfp-initial-product')].some(card=>card.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))"),true,'Widget skeletons must not remove or hide visible early cards');
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25",15000);
    await wait("!document.querySelector('#cfp-first-row')");
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {visibleDuringSkeletonHandoff:true,finalCards:25,liveTiming:false};
  });
  await test('saved cards include collection filters on the next visit without another facet request',async()=>{
    const filterSettings=[{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Brand',config:{}}];
    await control({reset:true,productCount:80,precompute:true,hold:true,cardSnapshots:true,early:true,noMerchandising:true,filterSettings,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await send('Network.clearBrowserCache');await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await wait("document.querySelector('#cfp-sidebar__filter-groups').textContent.includes('Fixture')");
    const first=await cards(),baseline=await getState();assert.equal(baseline.facetResponses.length,1);
    const filters=await evaluate("document.querySelector('#cfp-sidebar__filter-groups').textContent");
    assert.ok(filters.includes('80'),'Facet counts must cover all products, not the first page: '+filters);
    await control({facetFailure:true,facetDelay:5000});
    await send('Network.clearBrowserCache');await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await delay(500);
    const after=await getState();assert.equal(after.facetResponses.length,baseline.facetResponses.length);
    assert.equal(after.trace.facetQueries,baseline.trace.facetQueries);assert.deepEqual(await cards(),first);
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar__filter-groups').textContent"),filters);
    assert.equal(await evaluate("!!document.querySelector('.cfp-facet-error,.cfp-order-error')"),false);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {cards:25,facetCount:80,extraFacetRequests:0,liveTiming:false};
  });
  await test('saved first fifty bypass the pin preview and show Load more with the complete first page',async()=>{
    await control({reset:true,productCount:80,precompute:true,hold:true,cardSnapshots:true,publishedPages:false,publishFirst50:true,pinList:Array.from({length:13},(_,i)=>String(i+1)),headRenderer:true,early:true,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await control({rankingFailure:'throw',facetFailure:true});
    const baseline=await getState();
    await send('Network.clearBrowserCache');await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!!document.querySelector('#cfp-load-more-btn')");
    const first=await cards(),ready=await getState();
    assert.equal(new Set(first).size,25);
    assert.ok(ready.allRequests.some(r=>r.status===200&&r.source==='hit'));
    assert.equal(ready.allRequests.some(r=>r.source==='prefix'),false);
    assert.equal(ready.state.builds,baseline.state.builds);
    assert.equal(ready.trace.facetQueries,baseline.trace.facetQueries);
    assert.equal(await evaluate("!!document.querySelector('.cfp-facet-error,.cfp-order-error')"),false);
    await control({rankingFailure:null,facetFailure:false});
    await evaluate("window.retainedSavedCard=document.querySelector('.cfp-product-card');document.querySelector('#cfp-load-more-btn').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===50");
    assert.equal(new Set(await cards()).size,50);assert.deepEqual((await cards()).slice(0,25),first);
    assert.equal(await evaluate("document.querySelector('.cfp-product-card')===window.retainedSavedCard"),true);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {initialCards:25,afterLoadMore:50,pinPreview:false,extraFacetQueries:0,firstCardRetained:true,liveTiming:false};
  });
  await test('reload shows the complete saved browser row before the fresh API and widget finish',async()=>{
    await control({reset:true,productCount:80,precompute:true,hold:true,cardSnapshots:true,publishedPages:true,publishFirst50:true,headRenderer:true,early:true,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.equal(await evaluate("[...Object.keys(sessionStorage)].some(key=>key.startsWith('cfp:collection-result:v1:'))"),true);
    await control({apiDelay:1500,assetDelay:2000});
    await send('Network.clearBrowserCache');
    await send('Page.navigate',{url:origin+'/collections/fixture'});
    await wait("document.querySelectorAll('#cfp-first-row .cfp-initial-product').length===25");
    const early=await evaluate("({at:Math.round(performance.now()),count:document.querySelectorAll('#cfp-first-row .cfp-initial-product').length,widget:!!window._cfpInitStarted})");
    assert.equal(early.widget,false,'saved cards should appear before the full widget executes');
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-first-row')");
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {baselineCardsMs:early.at,earlyCards:early.count,widgetPending:true,liveTiming:false};
  });
  await test('published first fifty serve two 25-card pages while ranking and facets are unavailable',async()=>{
    await control({reset:true,productCount:80,precompute:true,hold:true,cardSnapshots:true,publishedPages:true,publishFirst50:true,headRenderer:true,early:true,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await control({unrelatedExternalUpdate:true,rankingFailure:'throw',facetFailure:true});
    const baseline=await getState();
    await send('Network.clearBrowserCache');await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!!document.querySelector('#cfp-load-more-btn')");
    const first=await cards();assert.equal(new Set(first).size,25);
    await evaluate("window.retainedPublishedCard=document.querySelector('.cfp-product-card');document.querySelector('#cfp-load-more-btn').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===50");
    const firstFifty=await cards(),after=await getState();
    assert.equal(new Set(firstFifty).size,50);assert.deepEqual(firstFifty.slice(0,25),first);
    assert.equal(await evaluate("document.querySelector('.cfp-product-card')===window.retainedPublishedCard"),true);
    assert.equal(after.state.builds,baseline.state.builds);assert.equal(after.trace.hydrations,baseline.trace.hydrations);assert.equal(after.trace.facetQueries,baseline.trace.facetQueries);
    assert.equal(await evaluate("!!document.querySelector('.cfp-facet-error,.cfp-order-error')"),false);
    await control({rankingFailure:null,facetFailure:false});
    await evaluate("document.querySelector('#cfp-load-more-btn').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal').length===75");
    assert.deepEqual((await cards()).slice(0,50),firstFifty);assert.equal(new Set(await cards()).size,75);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return {pageSizes:[25,50,75],firstTwoPagesWithoutPreparation:true,firstCardRetained:true,liveTiming:false};
  });
  await test('early cards retain configured columns and spacing through the full widget handoff',async()=>{
    const samples=[];
    for(const [width,desktop,mobile,expected]of [[1440,5,2,5],[1300,5,2,4],[991,5,2,4],[990,5,2,3],[769,5,2,3],[768,5,2,2],[480,5,2,2],[390,5,1,1],[1440,3,2,3]]){
      await control({reset:true,productCount:30,precompute:true,hold:true,headRenderer:true,early:true,desktopColumns:desktop,mobileColumns:mobile,assetDelay:1800,apiDelay:0,priceDelay:0,imageDelay:0,cssDelay:0});
      await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<=768});
      await send('Network.clearBrowserCache');await send('Page.navigate',{url:origin+'/collections/fixture'});
      await wait("document.querySelectorAll('.cfp-initial-product').length>=5");
      const metrics=selector=>evaluate(`(()=>{const grid=document.querySelector(${JSON.stringify(selector)}),style=getComputedStyle(grid);return {columns:style.gridTemplateColumns.split(' ').length,gap:style.columnGap}})()`);
      const early=await metrics('#cfp-first-row');assert.equal(early.columns,expected,`Early grid at ${width}px`);
      assert.equal(await evaluate('!!window._cfpInitStarted'),false);
      await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25&&!document.querySelector('#cfp-first-row')");
      const full=await metrics('#cfp-products-container');assert.deepEqual(full,early,`Grid handoff at ${width}px`);
      assert.deepEqual(await evaluate('browserErrors'),[]);samples.push({width,desktop,mobile,...early});
    }
    await control({reset:true});return {samples,liveLighthouseMeasurement:false};
  });
  await test('ranking tokens stay internal across pagination, legacy links and expired sessions',async()=>{
    await control({reset:true,precompute:true,noPins:true,delay:1,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !!document.querySelector('#cfp-load-more-btn')");
    const token=fixture.latestRankingToken();assert.ok(token);
    assert.equal(await evaluate("new URL(location.href).searchParams.has('rankingToken')"),false);
    const first=await cards();
    await evaluate("document.querySelector('#cfp-load-more-btn').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal').length===30");
    const all=await cards();assert.equal(new Set(all).size,30);assert.deepEqual(all.slice(0,25),first);
    assert.ok((await getState()).allRequests.some(r=>r.page==='2'&&r.token===token&&r.status===200));
    assert.equal(await evaluate("new URL(location.href).searchParams.has('rankingToken')"),false);
    await navigate('?page=2&rankingToken='+encodeURIComponent(token)+'&_ab=0');await wait("document.querySelectorAll('.cfp-product-card--reveal').length===5");
    assert.deepEqual(await cards(),all.slice(25));assert.equal(await evaluate("new URL(location.href).searchParams.has('rankingToken')"),false);
    assert.equal(await evaluate("new URL(location.href).searchParams.get('_ab')"),'0');
    await control({expireTokens:true});
    await navigate('?page=2&rankingToken='+encodeURIComponent(token));await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !!document.querySelector('#cfp-load-more-btn')");
    assert.equal(await evaluate("new URL(location.href).searchParams.has('rankingToken')"),false);assert.deepEqual(await evaluate('browserErrors'),[]);
    return {initial:25,afterLoadMore:30,uniqueProducts:30,legacyLinkAccepted:true,expiredSessionRestarted:true,tokenInAddressBar:false};
  });
  await test('settings audit mobile layouts, Quick View and presentation flags',async()=>{
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:667,deviceScaleFactor:1,mobile:true});
    for(const [settings,expected] of [
      [{mobileFilterLayout:'horizontal-scrolling',showQuickViewCollection:false},'cfp-mobile-horizontal-scrolling'],
      [{desktopLikeOnMobile:true,mobileFilterLayout:'horizontal-scrolling',showQuickViewCollection:true},'cfp-mobile-horizontal-scrolling'],
      [{mobileFilterLayout:'off-canvas',desktopLikeOnMobile:true,showQuickViewCollection:false},null],
    ]){
      await control({reset:true,hold:false,globalSettings:settings});await navigate();
      await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
      assert.equal(await evaluate("document.querySelectorAll('.cfp-quick-view-btn').length"),settings.showQuickViewCollection?25:0);
      assert.equal(await evaluate("document.body.classList.contains('cfp-desktop-like-mobile')"),false,'removed setting is ignored');
      if(expected){
        assert.equal(await evaluate(`document.body.classList.contains('${expected}')`),true);
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar')).position"),'sticky');
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-drawer-trigger-btn')).display"),'none');
        assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getAttribute('aria-hidden')"),'false');
      }else{
        assert.equal(await evaluate("document.body.classList.contains('cfp-mobile-horizontal-scrolling') || document.body.classList.contains('cfp-desktop-like-mobile')"),false);
        await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");
        assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open')"),true);
      }
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    for(const enabled of [true,false]){
      await control({reset:true,hold:false,globalSettings:{showQuickViewCollection:enabled,secondImageOnHover:enabled,isWholesale:!enabled,darkMode:enabled,showProductCount:enabled,desktopFilterLayout:'vertical'},productFields:{'1':{images:['/image/1.svg','/image/2.svg']}}});
      await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
      assert.equal(await evaluate("document.body.classList.contains('cfp-dark-mode')"),false,'legacy dark mode is ignored');

      assert.equal(await evaluate("document.body.classList.contains('cfp-vertical-layout')"),true,'vertical layout');
      assert.equal(await evaluate("document.querySelectorAll('.cfp-quick-view-btn').length"),enabled?25:0);
      assert.equal(await evaluate("document.querySelectorAll('.cfp-product-card__price-row').length"),enabled?25:0);
      assert.equal(await evaluate("!!document.querySelector('.cfp-product-card__image--secondary')"),enabled,'secondary image');
    }
  });
  await test('mobile layout controls open usable filter options and preserve drawer behavior',async()=>{
    const filterSettings=[{id:'price',isEnabled:true,filterType:'price',label:'Price',displayMode:'Range',config:{}},{id:'type',isEnabled:true,filterType:'product_type',label:'Product type',config:{}},{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Brand',config:{}},{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{}}];
    const tap=async selector=>{
      const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest',inline:'nearest'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(100);
    };
    for(const width of [320,390,768]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
      await control({reset:true,realToolbar:true,hold:false,delay:20,productCount:30,filterSettings,globalSettings:{mobileFilterLayout:'horizontal-scrolling',showFilterOptionsWithOneItem:true}});
      await navigate();await wait("document.querySelectorAll('#cfp-sidebar .cfp-group').length===4 && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar .cfp-group__toggle').getAttribute('aria-expanded')"),'false','mobile horizontal filters should start collapsed');
      assert.equal(await evaluate("document.querySelector('#cfp-drawer-trigger-btn').checkVisibility()"),false,'horizontal mode must not show a duplicate Filters button');
      await evaluate('window.cfpSyncPillsLayout()');
      assert.equal(await evaluate("document.querySelector('#cfp-drawer-trigger-btn').checkVisibility()"),false,'Liquid toolbar must not restore the duplicate button');
      const row=await evaluate("({sort:document.querySelector('#cfp-custom-sort-trigger').getBoundingClientRect().toJSON(),filter:document.querySelector('#cfp-sidebar .cfp-group__toggle').getBoundingClientRect().toJSON()})");
      assert.ok(Math.abs(row.sort.top-row.filter.top)<8,'Sorting and horizontal filters must share one row: '+JSON.stringify(row));
      assert.ok(row.sort.width>=132,'Sort control must not inherit the old half-width toolbar rule');
      assert.equal(await evaluate("(()=>{const e=document.querySelector('#cfp-custom-sort-label');return e.scrollWidth<=e.clientWidth;})()"),true,'Sort label is clipped');
      await tap('#cfp-custom-sort-trigger');
      const sortMenu=await evaluate("(()=>{const e=document.querySelector('#cfp-custom-sort-dropdown'),r=e.getBoundingClientRect();return{visible:e.checkVisibility(),left:r.left,right:r.right,top:r.top,bottom:r.bottom};})()");
      assert.ok(sortMenu.visible&&sortMenu.left>=0&&sortMenu.right<=width&&sortMenu.bottom<=844,JSON.stringify(sortMenu));
      await tap('#cfp-custom-sort-trigger');
      await tap('#cfp-sidebar .cfp-group__toggle');
      const panel=await evaluate("(()=>{const el=document.querySelector('#cfp-sidebar .cfp-group__content'),r=el.getBoundingClientRect();return{visible:el.checkVisibility(),top:r.top,bottom:r.bottom,left:r.left,right:r.right};})()");
      assert.ok(panel.visible&&panel.top>=0&&panel.bottom<=844&&panel.left>=0&&panel.right<=width,JSON.stringify(panel));
      assert.equal(await evaluate("getComputedStyle(document.querySelector('#cfp-sidebar .cfp-group__content')).position"),'fixed');
      if(width===390){const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true});await fs.writeFile('scratch/mobile-horizontal-price-390.png',Buffer.from(shot.data,'base64'));}
      await tap('#cfp-sidebar .cfp-group:nth-child(2) .cfp-group__toggle');
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar .cfp-group__toggle').getAttribute('aria-expanded')"),'false','opening another group must close the first');
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      assert.equal(await evaluate("document.querySelectorAll('#cfp-sidebar .cfp-group__toggle[aria-expanded=true]').length"),0);
      await tap('#cfp-sidebar .cfp-group[data-group="vendor-vendor"] .cfp-group__toggle');await tap('#cfp-sidebar input[name=vendor]');
      await wait("document.querySelector('#cfp-sidebar input[name=vendor]')?.checked && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      const updated=await evaluate("(()=>{const e=document.querySelector('#cfp-sidebar .cfp-group[data-group=\"vendor-vendor\"] .cfp-group__content'),r=e.getBoundingClientRect();return{visible:e.checkVisibility(),top:r.top,bottom:r.bottom};})()");
      assert.ok(updated.visible&&updated.top>=0&&updated.bottom<=844,'Dropdown lost its position after selecting a value: '+JSON.stringify(updated));
      assert.equal(await evaluate("document.querySelector('#cfp-drawer-trigger-btn').checkVisibility()"),false,'Results refresh restored the duplicate Filters button');
      const gridWidth=await evaluate("(()=>{const wrapper=document.querySelector('.cfp-layout-wrapper'),style=getComputedStyle(wrapper);return{products:document.querySelector('#cfp-products-container').getBoundingClientRect().width,available:wrapper.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)};})()");
      assert.ok(Math.abs(gridWidth.products-gridWidth.available)<2,'Products must retain the full row width: '+JSON.stringify(gridWidth));
      assert.equal(await evaluate("document.body.style.overflow"),'');assert.equal((await cards()).length,25);
      await control({reset:true,realToolbar:true,hold:false,delay:20,productCount:30,filterSettings,globalSettings:{mobileFilterLayout:'off-canvas',showFilterOptionsWithOneItem:true}});await navigate();
      await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      await tap('#cfp-drawer-trigger-btn');
      const drawer=await evaluate("({open:document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open'),hidden:document.querySelector('#cfp-sidebar').getAttribute('aria-hidden'),mobile:matchMedia('(max-width:768px)').matches,width:innerWidth,layout:window.cfpGlobalSettings?.mobileFilterLayout,classes:document.body.className,button:document.querySelector('#cfp-drawer-trigger-btn').getBoundingClientRect().toJSON()})");
      assert.ok(drawer.open&&drawer.hidden!=='true',JSON.stringify(drawer));
      await tap('#cfp-close-btn');assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getAttribute('aria-hidden')"),'true');
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }
  });
  await test('settings audit filter counts, single-value visibility and breadcrumbs',async()=>{
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    const filterSettings=[{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Brand',config:{}}];
    for(const enabled of [true,false]){
      await control({reset:true,hold:false,productCount:30,filterSettings,globalSettings:{desktopFilterLayout:'vertical',showProductCount:enabled,showFilterOptionsWithOneItem:enabled,showAttributeBasedBreadcrumb:enabled}});
      await navigate('?vendors=Fixture');await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      assert.equal(await evaluate("!!document.querySelector('#cfp-sidebar input[name=vendor]')"),enabled,'single-value filter visibility');
      assert.equal(await evaluate("!!document.querySelector('#cfp-sidebar .cfp-checkbox__count')"),enabled,'filter product counts');
      assert.equal(await evaluate("!!document.querySelector('.cfp-breadcrumb-chip')"),enabled,'active attribute breadcrumbs');
    }
  });
  await test('selected color breadcrumb shows only the bold color name',async()=>{
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    const filterSettings=[{id:'color',isEnabled:true,filterType:'option',filterKey:'Color',label:'Color',config:{}}];
    await control({reset:true,hold:false,productCount:30,filterSettings,globalSettings:{desktopFilterLayout:'vertical',showAttributeBasedBreadcrumb:true}});
    await navigate('?option_Color=Blue');
    await wait("document.querySelector('.cfp-breadcrumb-chip--color .cfp-breadcrumb-color')?.textContent==='Blue'");
    assert.equal(await evaluate("document.querySelector('.cfp-breadcrumb-chip--color').textContent.replace('×','').trim()"),'Blue');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.cfp-breadcrumb-color')).fontWeight"),'700');
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('settings audit desktop layouts, responsive transitions and vertical scrolling',async()=>{
    const filterSettings=[{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Brand',config:{}}];
    for(const layout of ['horizontal','vertical','drawer']){
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await control({reset:true,hold:false,productCount:30,filterSettings,globalSettings:{desktopFilterLayout:layout,mobileFilterLayout:'horizontal-scrolling',showFilterOptionsWithOneItem:true,scrollUpOnFilterValuesChange:true}});
      await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      assert.equal(await evaluate(`document.body.classList.contains('cfp-${layout}-layout')`),true);
      await evaluate("window.scrollCalls=[];window.scrollTo=(...args)=>window.scrollCalls.push(args);const input=document.querySelector('#cfp-sidebar input[name=vendor]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));");
      await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      assert.equal(await evaluate('window.scrollCalls.length>0'),true,'scroll on filter changes in each desktop layout');
      await send('Emulation.setDeviceMetricsOverride',{width:375,height:667,deviceScaleFactor:1,mobile:true});
      await wait("document.body.classList.contains('cfp-mobile-horizontal-scrolling')");
      assert.equal(await evaluate("document.querySelector('#cfp-sidebar').getAttribute('aria-hidden')"),'false');
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await wait(`document.body.classList.contains('cfp-${layout}-layout') && !document.body.classList.contains('cfp-mobile-horizontal-scrolling')`);
    }
    await control({reset:true,hold:false,productCount:30,filterSettings,globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true,scrollUpOnFilterValuesChange:false}});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await evaluate("window.scrollCalls=[];window.scrollTo=(...args)=>window.scrollCalls.push(args);const input=document.querySelector('#cfp-sidebar input[name=vendor]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));");
    await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");assert.equal(await evaluate('window.scrollCalls.length'),0,'disabled scrolling');
  });
  await test('scroll setting moves the viewport for filter changes across layouts and waits for drawer close',async()=>{
    const filters=[{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Brand',config:{}}];
    for(const [width,desktop,mobile] of [[1440,'vertical','off-canvas'],[1440,'horizontal','off-canvas'],[1440,'drawer','off-canvas'],[390,'vertical','horizontal-scrolling'],[390,'vertical','off-canvas']]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<769});
      await control({reset:true,hold:false,delay:20,productCount:60,filterSettings:filters,globalSettings:{desktopFilterLayout:desktop,mobileFilterLayout:mobile,showFilterOptionsWithOneItem:true,scrollUpOnFilterValuesChange:true}});
      await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      await evaluate('window.scrollTo({top:700,behavior:"instant"})');await wait('scrollY>400');
      const drawer=width>768?desktop==='drawer':mobile==='off-canvas';
      if(drawer)await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");
      await evaluate("const input=document.querySelector('#cfp-sidebar input[name=vendor]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));");
      if(drawer){await delay(150);assert.ok(await evaluate('scrollY>400'),'Do not scroll while the drawer is open');await evaluate("document.querySelector('#cfp-apply-btn').click()");}
      await wait("scrollY<5 && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      await evaluate('window.scrollTo({top:700,behavior:"instant"})');await wait('scrollY>400');
      await evaluate("document.querySelector('#cfp-load-more-btn').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal').length===50");
      assert.ok(await evaluate('scrollY>400'),'Load more must not scroll to the top');
      await evaluate("document.querySelector('.cfp-custom-sort__option[data-value=\"price-ascending\"]').click()");
      await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");assert.ok(await evaluate('scrollY>400'),'Sorting must not count as a filter-value change');
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }
    await control({reset:true,hold:false,delay:20,productCount:60,filterSettings:filters,globalSettings:{desktopFilterLayout:'vertical',showFilterOptionsWithOneItem:true,scrollUpOnFilterValuesChange:false}});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
    await evaluate('window.scrollTo({top:700,behavior:"instant"});const input=document.querySelector("#cfp-sidebar input[name=vendor]");input.checked=true;input.dispatchEvent(new Event("change",{bubbles:true}));');
    await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");assert.ok(await evaluate('scrollY>400'),'Disabled setting must retain scroll position');
  });
  await test('published rule changes refresh two new storefront visits',async()=>{
    await control({reset:true,productCount:60,precompute:true,hold:true,cardSnapshots:true,publishedPages:true,publishFirst50:true,headRenderer:true,early:true,apiDelay:0,assetDelay:0,priceDelay:0,imageDelay:0});
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !!document.querySelector('#cfp-load-more-btn')");
    assert.deepEqual((await cards()).slice(0,2),['1','2']);
    await control({pin:'4',boost:'5',invalidate:true,hold:false,delay:20});
    for(let visit=0;visit<2;visit++){
      await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !!document.querySelector('#cfp-load-more-btn')");
      assert.deepEqual((await cards()).slice(0,2),['4','5']);
    }
    const responses=await getState();assert.ok(responses.allRequests.some(r=>r.status===200&&r.source!=='published'));
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('stock rollback keeps collection and search cards available with the saved stock toggle enabled',async()=>{
    for(const query of ['', '?q=dress'])for(let visit=0;visit<2;visit++){
      await control({reset:true,productCount:60,hold:false,delay:20,globalSettings:{showOnlyInStock:true}});
      await navigate(query);await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !!document.querySelector('#cfp-load-more-btn')");
      const first=await cards();assert.equal(new Set(first).size,25);
      await evaluate("document.querySelector('#cfp-load-more-btn').click()");
      await wait("document.querySelectorAll('.cfp-product-card--reveal').length===50");
      const all=await cards();assert.equal(new Set(all).size,50);assert.deepEqual(all.slice(0,25),first);
      assert.deepEqual(await evaluate('browserErrors'),[]);
    }
  });
  await fs.writeFile('scratch/collection-headless-results.json',JSON.stringify({browser:version.product,headless:true,queueBackend:redisLayer?'Real Redis/BullMQ in unique temporary namespace':'In-memory',environment:'Actual storefront assets/API/early Liquid script; fixture catalog/index/session data and injected delays; no live cache/queue keys/settings changed and no push',results},null,2));
  console.log(`HEADLESS COLLECTION CHECKS PASSED: ${results.length}`);
}catch(error){
  console.error(error.stack);
  const diagnostic=await getState().catch(()=>null);
  const queueCounts=redisLayer?await redisLayer.queue.getJobCounts('waiting','prioritized','active','failed','delayed'):null;
  await fs.writeFile('scratch/collection-headless-results.json',JSON.stringify({headless:true,results,error:error.message,diagnostic,queueCounts},null,2));
  process.exitCode=1;
}finally{
  socket?.close();chrome.kill();fixture.dispose();await redisLayer?.close();
}
