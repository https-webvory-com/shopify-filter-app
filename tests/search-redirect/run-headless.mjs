import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRedirectServer as createLoadingServer} from './server.mjs';
import {createRedisTestLayer} from '../collection-loading/redis-layer.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const redisLayer=process.argv.includes('--real-redis')?await createRedisTestLayer():null;
let fixture;
try{fixture=await createLoadingServer({redisLayer});}catch(error){await redisLayer?.close();throw error;}
await new Promise((resolve,reject)=>{fixture.server.once('error',reject);fixture.server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+fixture.server.address().port;
const profile=path.resolve('scratch',`redirect-browser-${process.pid}-${Date.now()}`);
await fs.mkdir(profile,{recursive:true});
const chrome=spawn(process.env.HEADLESS_CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--disable-gpu','--in-process-gpu','--disable-background-networking','--disable-component-update','--disable-sync',
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
  await delay(1500);
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


  await send('Page.navigate',{url:origin+'/admin-ui'});await wait("!!document.querySelector('textarea[name=queries]')");
  const fill=async(queries,target)=>evaluate(`(() => {for(const [selector,value]of [['textarea[name=queries]',${JSON.stringify(queries)}],['input[name=targetUrl]',${JSON.stringify(target)}]]){const el=document.querySelector(selector);const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}return true;})()`);
  const click=async(text)=>{await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==="+JSON.stringify(text)+"&&!b.disabled)");return evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==="+JSON.stringify(text)+").click()");};
  await fill('Shipping\nshipping policy','/policies/shipping-policy');await click('Create redirect');await wait("document.body.innerText.includes('shipping policy')&&!!document.querySelector('button:not([disabled])')&&document.querySelector('textarea').value===''");
  assert.ok(await evaluate("document.body.innerText.includes('/policies/shipping-policy')"));console.log('PASS browser creates multi-query redirect in real PostgreSQL');
  await send('Page.navigate',{url:origin+'/search?q=SHIPPING'});await wait("location.pathname==='/policies/shipping-policy'");console.log('PASS full storefront redirects submitted query');
  await send('Page.navigate',{url:origin+'/search?q=shipping&native=1'});await wait("location.pathname==='/policies/shipping-policy'");console.log('PASS native storefront search redirects without filter block');
  const before=fixture.state.redirectRequests;
  await send('Page.navigate',{url:origin+'/search?q=shipping&embed=1'});await wait("location.pathname==='/policies/shipping-policy'");assert.equal(fixture.state.redirectRequests-before,1);console.log('PASS embed and filter block share one lookup');
  await send('Page.navigate',{url:origin+'/search?q=ordinary&native=1'});await wait("!!document.querySelector('#nativeResults')&&!!window.cfpSearchRedirectPromise");await evaluate('window.cfpSearchRedirectPromise');assert.equal(await evaluate('location.pathname'),'/search');console.log('PASS ordinary native search stays available');
  await send('Page.navigate',{url:origin+'/admin-ui'});await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Edit')");await click('Edit');await fill('delivery','/pages/delivery');await click('Update redirect');await wait("document.querySelector('textarea').value===''&&document.body.innerText.includes('/pages/delivery')");
  await send('Page.navigate',{url:origin+'/en/search?q=delivery'});await wait("location.pathname==='/pages/delivery'");console.log('PASS browser edit and localized storefront redirect');
  await send('Page.navigate',{url:origin+'/admin-ui'});await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Disable')");await click('Disable');await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Enable')");
  await send('Page.navigate',{url:origin+'/search?q=delivery'});await wait("document.querySelector('.cfp-empty-state')||document.querySelector('.cfp-products-grid')?.textContent.includes('No')");assert.equal(await evaluate('location.pathname'),'/search');console.log('PASS disabled redirect preserves normal search');
  await send('Page.navigate',{url:origin+'/admin-ui'});await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Enable')");await click('Enable');await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Disable')");await fill('DELIVERY','/pages/other');await click('Create redirect');await wait("document.querySelector('[role=alert]')?.textContent.includes('already belongs')");console.log('PASS duplicate query shows admin error');
  await fill('other','javascript:alert(1)');await click('Create redirect');await wait("document.querySelector('[role=alert]')?.textContent.includes('HTTPS')");console.log('PASS unsafe URL shows admin validation');
  await send('Page.navigate',{url:origin+'/search?q=offline'});await wait("document.querySelector('.cfp-empty-state')||document.querySelector('.cfp-products-grid')?.textContent.includes('No')");assert.equal(await evaluate('location.pathname'),'/search');console.log('PASS failed lookup preserves normal search');
  await send('Page.navigate',{url:origin+'/admin-ui'});await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Delete')");await evaluate('window.confirm=()=>true');await click('Delete');await wait("document.body.innerText.includes('No redirects yet')");console.log('PASS browser delete persists');
  console.log('HEADLESS REDIRECT CHECKS PASSED');
} catch(error) {console.error(error);console.error(stderr.slice(-2000));process.exitCode=1;}
finally {socket?.close();chrome.kill();await fixture.dispose();await redisLayer?.close();}
