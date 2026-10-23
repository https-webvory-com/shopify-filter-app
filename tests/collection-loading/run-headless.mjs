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
const phases=data=>({...data,allRequests:data.requests,facetResponses:data.requests.filter(r=>r.profile==='collection-v1'&&r.page==='1'&&r.token),requests:data.requests.filter(r=>!(r.profile==='collection-v1'&&r.page==='1'&&r.token))});
const getState=async()=>phases(await(await fetch(origin+'/__state')).json());
let beforeReset=async()=>{};
const control=async values=>{if(values.reset)await beforeReset();const response=await fetch(origin+'/__control',{method:'POST',body:JSON.stringify(values)});return phases(await response.json());};
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
  console.log('Headless browser connected: '+version.product);

  await test('cards render within two seconds while slow facets finish later and failed facets preserve cards',async()=>{
    await control({reset:true,hold:true,precompute:true,early:true,assetDelay:200,apiDelay:300,facetDelay:3000,clockOffset:0,cssDelay:0});
    await send('Network.clearBrowserCache');await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    const first=await cards(),at=await evaluate('cardSnapshots[0].at');if(!redisLayer)assert.ok(at<2000,'Cards exceeded fixture target: '+at);
    assert.ok(await evaluate("document.querySelectorAll('.cfp-product-card__price,.cfp-quick-view-btn,.cfp-product-swatches').length")>0);
    const firstImages=await evaluate("[...document.querySelectorAll('.cfp-product-card__image--primary')].map(e=>e.getAttribute('src'))");
    assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')"),true);
    await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')",10000);
    assert.equal((await cards()).length,25);assert.deepEqual((await cards()).slice(0,first.length),first);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.cfp-product-card__image--primary')].map(e=>e.getAttribute('src'))"),firstImages);
    let data=await getState();assert.equal(data.requests.length,1);assert.equal(data.facetResponses.length,1);
    await control({facetDelay:0,facetFailure:true});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");await wait("!!document.querySelector('.cfp-facet-error')");
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
    await evaluate("document.querySelector('#cfp-close-btn').click()");assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open')"),false);
    const image=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile('scratch/collection-headless-mobile.png',Buffer.from(image.data,'base64'));
  });
  await test('unavailable preparation stops polling, shows Retry, and recovers after Retry',async()=>{
    await control({reset:true,hold:true,noPins:true});await navigate();await wait("!!document.querySelector('.cfp-order-error button')",110000);
    assert.equal((await cards()).length,0);assert.equal(await evaluate('!!document.querySelector(".cfp-loading-notice")'),false);
    const before=(await getState()).requests.length;assert.equal(before,31);
    await delay(1400);assert.equal((await getState()).requests.length,before);
    await control({invalidate:true,hold:false,delay:100});await evaluate("document.querySelector('.cfp-order-error button').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25",15000);assert.equal(await evaluate('!!document.querySelector(".cfp-order-error")'),false);
    return {boundedRequests:before,retryRecovered:true};
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
  await test('network loss shows Retry and returns to the cached collection when restored',async()=>{
    await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await evaluate("document.querySelector('[data-value=\"price-ascending\"]').click()");await wait("!!document.querySelector('.cfp-order-error button')");
    await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await evaluate("document.querySelector('.cfp-order-error button').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal:not(.cfp-product-card--preview)').length===25");
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
    const first=await evaluate("(()=>{window.firstStreamCard=document.querySelector('.cfp-initial-product');return {at:performance.now(),count:document.querySelectorAll('.cfp-initial-product').length,title:firstStreamCard.textContent,widget:!!window._cfpInitStarted}})()");
    assert.ok(first.count<25);assert.ok(first.title);assert.equal(first.widget,false);
    const count=await evaluate("window._cfpRankedEarlyFetch.promise.then(r=>r.payload.products.length)");assert.equal(count,25);
    await wait("document.querySelectorAll('.cfp-initial-product').length===25");
    assert.equal(await evaluate("firstStreamCard===document.querySelector('.cfp-initial-product')"),true);
    const state=await getState();assert.equal(state.requests.length,1);assert.deepEqual(await evaluate('browserErrors'),[]);
    await control({streamDelay:0,assetDelay:0,headRenderer:false,early:false,hold:false});
    return {firstCardMs:Math.round(first.at),cardsAtFirstPaint:first.count,artificialTailDelayMs:160,liveTiming:false};
  });
  await test('a cold all-pin head renders with the ranking worker paused and hands off to canonical pagination',async()=>{
    await control({reset:true,hold:true,pinList:['1','2','4','5','6','7'],early:true,headRenderer:true,assetDelay:300,apiDelay:50,cssDelay:0,imageDelay:50,priceDelay:50});
    await send('Network.clearBrowserCache');await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===6");
    const prefix=await cards(),at=await evaluate('cardSnapshots[0].at');
    assert.deepEqual(prefix,['1','2','4','5','6','7']);
    assert.equal((await getState()).state.builds,0);assert.equal(await evaluate("new URL(location.href).searchParams.has('rankingToken')"),false);
    assert.equal(await evaluate("!!document.querySelector('#cfp-load-more-btn')"),false);
    assert.equal(await evaluate("document.querySelector('.cfp-product-count').textContent"),'');
    await fixture.prepareLast();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
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
    assert.equal(requests.length,2);assert.ok(requests.every(r=>r.status===200&&r.ranking==='ready'));assert.equal(after.state.builds,before.state.builds);
    assert.equal(await evaluate("!!document.querySelector('.cfp-facet-error,.cfp-order-error')"),false);assert.deepEqual(await evaluate('browserErrors'),[]);
    return {filterSelections:2,pendingResponses:0,workerPaused:true,liveTiming:false};
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
      [{desktopLikeOnMobile:true,showQuickViewCollection:true},'cfp-desktop-like-mobile'],
      [{mobileFilterLayout:'off-canvas',desktopLikeOnMobile:false,showQuickViewCollection:false},null],
    ]){
      await control({reset:true,hold:false,globalSettings:settings});await navigate();
      await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
      assert.equal(await evaluate("document.querySelectorAll('.cfp-quick-view-btn').length"),settings.showQuickViewCollection?25:0);
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
  await test('settings audit desktop layouts, responsive transitions and vertical scrolling',async()=>{
    const filterSettings=[{id:'vendor',isEnabled:true,filterType:'vendor',filterKey:'vendor',label:'Brand',config:{}}];
    for(const layout of ['horizontal','vertical','drawer']){
      await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await control({reset:true,hold:false,productCount:30,filterSettings,globalSettings:{desktopFilterLayout:layout,mobileFilterLayout:'horizontal-scrolling',showFilterOptionsWithOneItem:true,scrollUpOnFilterValuesChange:true}});
      await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25 && !document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      assert.equal(await evaluate(`document.body.classList.contains('cfp-${layout}-layout')`),true);
      await evaluate("window.scrollCalls=[];window.scrollTo=(...args)=>window.scrollCalls.push(args);const input=document.querySelector('#cfp-sidebar input[name=vendor]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));");
      await wait("!document.querySelector('#cfp-sidebar').classList.contains('cfp-loading')");
      assert.equal(await evaluate('window.scrollCalls.length>0'),layout==='vertical','scroll only in vertical mode');
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
  const diagnostic=await getState().catch(()=>null);
  const queueCounts=redisLayer?await redisLayer.queue.getJobCounts('waiting','prioritized','active','failed','delayed'):null;
  await fs.writeFile('scratch/collection-headless-results.json',JSON.stringify({headless:true,results,error:error.message,diagnostic,queueCounts},null,2));
  process.exitCode=1;
}finally{
  socket?.close();chrome.kill();fixture.dispose();await redisLayer?.close();
}
