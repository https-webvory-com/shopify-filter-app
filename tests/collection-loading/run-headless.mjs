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
const control=async values=>{const response=await fetch(origin+'/__control',{method:'POST',body:JSON.stringify(values)});return response.json();};
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
  const test=async(name,fn)=>{try{const detail=await fn();results.push({name,passed:true,detail});console.log('PASS '+name);}catch(error){results.push({name,passed:false,error:error.message});console.log('FAIL '+name+': '+error.message);throw error;}};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  const version=await send('Browser.getVersion');
  console.log('Headless browser connected: '+version.product);

  await test('cold pending ranking shows skeletons and loading feedback, then independent card/image/price rendering',async()=>{
    await control({reset:true,delay:5500,priceDelay:2500,imageDelay:3000});await navigate();
    await wait("document.querySelectorAll('.cfp-skeleton-card').length===8");assert.equal((await cards()).length,0);
    await wait("!!document.querySelector('.cfp-loading-notice')",15000);assert.equal((await cards()).length,0);
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25",15000);
    const snapshot=await evaluate('cardSnapshots[0]');assert.equal(snapshot.imagesLoaded,0);assert.equal(snapshot.pricesReady,0);
    assert.deepEqual(snapshot.delays,['0s','0.075s','0.15s','0.225s','0.3s','0.375s']);
    assert.equal(await evaluate('!!document.querySelector(".cfp-loading-notice")'),false);
    assert.deepEqual((await cards()).slice(0,2),['1','2']);
    await wait("document.querySelector('.cfp-product-card--reveal .cfp-product-card__price').textContent!=='See product price'",15000);
    await wait("document.querySelector('.cfp-product-card--reveal img').naturalWidth>0",15000);
    assert.deepEqual(await evaluate('browserErrors'),[]);return snapshot;
  });
  await test('a repeat page uses the prepared cache without another build',async()=>{
    const start=Date.now();await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25",8000);
    const data=await(await fetch(origin+'/__state')).json();assert.equal(data.state.builds,1);return {browserReadyMs:Date.now()-start,builds:data.state.builds};
  });
  let oldToken,oldIds;
  await test('load more keeps token order without duplicate products and puts zero-price product last',async()=>{
    oldToken=await evaluate("new URL(location.href).searchParams.get('rankingToken')");
    await evaluate("document.querySelector('#cfp-load-more-btn').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal').length===30");
    oldIds=await cards();assert.equal(new Set(oldIds).size,30);assert.equal(oldIds.at(-1),'3');
    const data=await(await fetch(origin+'/__state')).json();assert.ok(data.requests.some(r=>r.page==='2'&&r.token===oldToken&&r.status===200));return {products:oldIds.length,zeroPriceLast:oldIds.at(-1)};
  });
  await test('pin/rule changes affect a new visit while an existing page-two token stays consistent',async()=>{
    await control({invalidate:true,pin:'4',boost:'5',delay:1800,priceDelay:50,imageDelay:50});
    await navigate('?page=2&rankingToken='+encodeURIComponent(oldToken));await wait("document.querySelectorAll('.cfp-product-card--reveal').length===5");
    assert.deepEqual(await cards(),oldIds.slice(25));
    await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25",15000);assert.deepEqual((await cards()).slice(0,2),['4','5']);
    return {newFirstProducts:(await cards()).slice(0,2),oldPageTwoPreserved:true};
  });
  await test('changing sort cancels pending polling and cannot overwrite the newer cached result',async()=>{
    await control({hold:true});await evaluate("document.querySelector('[data-value=\"price-ascending\"]').click()");
    await wait("document.querySelectorAll('.cfp-skeleton-card').length===8");
    await evaluate("document.querySelector('[data-value=\"best-selling\"]').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    const before=(await(await fetch(origin+'/__state')).json()).requestStarts.filter(r=>r.sort==='price-ascending').length;
    assert.equal(before,1);
    await delay(2200);const after=(await(await fetch(origin+'/__state')).json()).requestStarts.filter(r=>r.sort==='price-ascending').length;
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
    await control({hold:false});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.cfp-product-card--reveal')).animationName"),'none');
  });
  await test('mobile collection cards fit the viewport and filter drawer can open and close',async()=>{
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:667,deviceScaleFactor:1,mobile:true});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+2'));
    await evaluate("document.querySelector('#cfp-drawer-trigger-btn').click()");assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open')"),true);
    await evaluate("document.querySelector('#cfp-close-btn').click()");assert.equal(await evaluate("document.querySelector('#cfp-sidebar').classList.contains('cfp-sidebar--open')"),false);
    const image=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile('scratch/collection-headless-mobile.png',Buffer.from(image.data,'base64'));
  });
  await test('unavailable preparation stops polling, shows Retry, and recovers after Retry',async()=>{
    await control({reset:true,hold:true});await navigate();await wait("!!document.querySelector('.cfp-order-error button')",110000);
    assert.equal((await cards()).length,0);assert.equal(await evaluate('!!document.querySelector(".cfp-loading-notice")'),false);
    const before=(await(await fetch(origin+'/__state')).json()).requests.length;assert.equal(before,31);
    await delay(1400);assert.equal((await(await fetch(origin+'/__state')).json()).requests.length,before);
    await control({invalidate:true,hold:false,delay:100});await evaluate("document.querySelector('.cfp-order-error button').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25",15000);assert.equal(await evaluate('!!document.querySelector(".cfp-order-error")'),false);
    return {boundedRequests:before,retryRecovered:true};
  });
  await test('continuous unrelated product updates do not restart this collection ranking',async()=>{
    await control({reset:true,delay:1500,stormCollection:'2'});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25",15000);
    await delay(1700);await control({stopStorm:true});
    const data=await(await fetch(origin+'/__state')).json();assert.equal(data.state.builds,1);assert.equal(data.productRevision,'0');assert.deepEqual(data.queueFailures,[]);
    return {builds:data.state.builds,unrelatedUpdatesDidNotInvalidate:true};
  });
  await test('continuous relevant updates do not starve a cold build or delete queue metadata',async()=>{
    await control({reset:true,delay:1500,stormCollection:'1'});await navigate();
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25",15000);await control({stopStorm:true});
    const data=await(await fetch(origin+'/__state')).json();assert.ok(Number(data.productRevision)>0);assert.deepEqual(data.queueFailures,[]);assert.equal((await cards()).length,25);
    return {productUpdatesDuringBuild:Number(data.productRevision),cardsLoaded:true,unknownJobErrors:0};
  });
  await test('corrupt Redis preparation rebuilds and renders a fresh collection',async()=>{
    await control({reset:true,delay:100});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    await control({corruptPrepared:true});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    const data=await(await fetch(origin+'/__state')).json();assert.equal(data.state.builds,2);assert.deepEqual(data.queueFailures,[]);
  });
  await test('expired page-two token automatically restarts once from page one',async()=>{
    const token=await evaluate("new URL(location.href).searchParams.get('rankingToken')");await control({expireTokens:true});
    await navigate('?page=2&rankingToken='+encodeURIComponent(token));await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.ok([null,'1'].includes(await evaluate("new URL(location.href).searchParams.get('page')")));
    const data=await(await fetch(origin+'/__state')).json();assert.equal(data.requests.filter(r=>r.status===409).length,1);
  });
  for(const action of ['archive','deleteProduct'])await test(action+' of a cached first-page product rebuilds instead of repeated broken tokens',async()=>{
    await control({reset:true,delay:100});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    await control({[action]:'30'});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.ok(!(await cards()).includes('30'));
    const data=await(await fetch(origin+'/__state')).json();assert.equal(data.state.builds,2);assert.equal(data.requests.filter(r=>r.status===409).length,1);
  });
  for(const failure of ['html','empty'])await test('invalid '+failure+' API response shows Retry and recovers',async()=>{
    await control({reset:true,apiFailure:failure});await navigate();await wait("!!document.querySelector('.cfp-order-error button')");assert.equal((await cards()).length,0);
    await control({apiFailure:null});await evaluate("document.querySelector('.cfp-order-error button').click()");
    await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('network loss shows Retry and returns to the cached collection when restored',async()=>{
    await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await evaluate("document.querySelector('[data-value=\"price-ascending\"]').click()");await wait("!!document.querySelector('.cfp-order-error button')");
    await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
    await evaluate("document.querySelector('.cfp-order-error button').click()");await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.deepEqual(await evaluate('browserErrors'),[]);
  });
  await test('variant-dependent merchandising preserves global order and selected images across small batches',async()=>{
    await control({reset:true,colorRule:true,delay:100});await navigate();await wait("document.querySelectorAll('.cfp-product-card--reveal').length===25");
    assert.deepEqual((await cards()).slice(0,2),['1','30']);
    assert.ok(await evaluate("document.querySelector('.cfp-product-card--reveal img').src.includes('/image/1.svg')"));
    const data=await(await fetch(origin+'/__state')).json();assert.equal(data.state.builds,1);assert.deepEqual(data.queueFailures,[]);assert.deepEqual(await evaluate('browserErrors'),[]);
    return {variantRuleAcrossBatches:true,firstProducts:(await cards()).slice(0,2)};
  });
  await fs.writeFile('scratch/collection-headless-results.json',JSON.stringify({browser:version.product,headless:true,queueBackend:redisLayer?'Real Redis/BullMQ in unique temporary namespace':'In-memory',environment:'Local unmodified storefront assets and API loader; fixture catalog/index/session data; no live cache/queue keys or settings changed and no push',results},null,2));
  console.log(`HEADLESS COLLECTION CHECKS PASSED: ${results.length}`);
}catch(error){
  const diagnostic=await(await fetch(origin+'/__state')).json().catch(()=>null);
  const queueCounts=redisLayer?await redisLayer.queue.getJobCounts('waiting','prioritized','active','failed','delayed'):null;
  await fs.writeFile('scratch/collection-headless-results.json',JSON.stringify({headless:true,results,error:error.message,diagnostic,queueCounts},null,2));
  process.exitCode=1;
}finally{
  socket?.close();chrome.kill();fixture.dispose();await redisLayer?.close();
}
