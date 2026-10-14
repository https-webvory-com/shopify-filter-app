import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createBlacklistServer as createLoadingServer} from './server.mjs';
import {createRedisTestLayer} from '../collection-loading/redis-layer.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const redisLayer=process.argv.includes('--real-redis')?await createRedisTestLayer():null;
let fixture;
try{fixture=await createLoadingServer({redisLayer});}catch(error){await redisLayer?.close();throw error;}
await new Promise((resolve,reject)=>{fixture.server.once('error',reject);fixture.server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+fixture.server.address().port;
const profile=path.resolve('scratch',`blacklist-browser-${process.pid}-${Date.now()}`);
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

  const goAdmin=async()=>{await send('Page.navigate',{url:origin+'/admin-ui'});await wait("!!document.querySelector('input[name=term]')");};
  const click=async(text)=>{await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==="+JSON.stringify(text)+"&&!b.disabled)");return evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==="+JSON.stringify(text)+").click()");};
  const fill=async(term,operator)=>evaluate(`(() => {const input=document.querySelector('input[name=term]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(term)});input.dispatchEvent(new Event('input',{bubbles:true}));const select=document.querySelector('select[name=operator]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,${JSON.stringify(operator)});select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const suggestionLabels=()=>evaluate("[...document.querySelectorAll('#cfp-recent-searches-list a')].map(a=>a.textContent.trim())");
  const search=async()=>{
    const before=fixture.state.searchRequests;
    await send('Page.navigate',{url:origin+'/store'});await wait("!!document.getElementById('cfp-main-search-input')");
    await evaluate("document.getElementById('open-search').click();const input=document.getElementById('cfp-main-search-input');input.value='dress';input.dispatchEvent(new Event('input',{bubbles:true}));");
    await wait("document.querySelectorAll('#cfp-search-products .cfp-product-card').length===4");
    for(let attempt=0;attempt<100&&fixture.state.searchRequests<=before;attempt++)await delay(25);
    await delay(500);
    assert.equal(fixture.state.searchRequests>before,true);
    assert.deepEqual(await evaluate('browserErrors'),[]);
    return suggestionLabels();
  };

  await test('baseline autocomplete shows suggestions and primes the product cache',async()=>{
    const labels=await search();assert.ok(labels.includes('Blue Dress'));assert.ok(labels.includes('Blue Dress Sale'));
    assert.ok(await evaluate("Object.keys(sessionStorage).some(key=>key.startsWith('cfp_instant_search_'))"));
  });
  await test('editor creates an Exact match rule and cached product results keep working',async()=>{
    await goAdmin();await fill(' BLUE  DRESS ','exact');await click('Create rule');await wait("document.querySelector('input[name=term]').value===''&&document.body.innerText.includes('blue dress')");
    const labels=await search();assert.ok(!labels.includes('Blue Dress'));assert.ok(labels.includes('Blue Dress Sale'));assert.ok(labels.includes('Red Dress'));
  });
  await test('editing to Contains removes partial matches but keeps all product cards',async()=>{
    await goAdmin();await click('Edit');await fill('blue dress','contains');await click('Update rule');await wait("document.querySelector('input[name=term]').value===''");
    const labels=await search();assert.ok(!labels.some(value=>value.startsWith('Blue Dress')));assert.ok(labels.includes('Red Dress'));
  });
  await test('disable and enable are reflected on the next repeated search',async()=>{
    await goAdmin();await click('Disable');await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Enable')");
    assert.ok((await search()).includes('Blue Dress'));
    await goAdmin();await click('Enable');await wait("[...document.querySelectorAll('button')].some(b=>b.textContent==='Disable')");
    assert.ok(!(await search()).includes('Blue Dress'));
  });
  await test('duplicates show an error and preserve the existing rule',async()=>{
    await goAdmin();await fill('BLUE DRESS','contains');await click('Create rule');await wait("document.querySelector('[role=alert]')?.textContent.includes('already exist')");
    assert.ok(!(await search()).includes('Blue Dress'));
  });
  await test('blocking every suggestion hides the suggestion section but preserves products',async()=>{
    await goAdmin();await fill('dress','contains');await click('Create rule');await wait("document.querySelector('input[name=term]').value===''");
    await search();assert.equal(await evaluate("getComputedStyle(document.getElementById('cfp-recent-searches-container')).display"),'none');
  });
  await test('rule database failure keeps product cards available without leaking blocked suggestions',async()=>{
    fixture.state.failRules=true;await search();
    assert.equal(await evaluate("getComputedStyle(document.getElementById('cfp-recent-searches-container')).display"),'none');fixture.state.failRules=false;
  });
  await test('delete restores suggestions and persists after a page reload',async()=>{
    await goAdmin();await evaluate('window.confirm=()=>true');await click('Delete');
    await wait("[...document.querySelectorAll('button')].filter(b=>b.textContent==='Delete').length===1");await click('Delete');await wait("document.body.innerText.includes('No blacklist rules yet')");
    assert.ok((await search()).includes('Blue Dress'));await goAdmin();assert.ok(await evaluate("document.body.innerText.includes('No blacklist rules yet')"));
  });
  await test('mobile editor fits without horizontal text overflow',async()=>{
    await send('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:false});await goAdmin();
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
  });
  await fs.writeFile('scratch/blacklist-headless-results.json',JSON.stringify({browser:version.product,results,environment:'Actual local editor/search API/autocomplete and isolated PostgreSQL; fixture authentication/catalog; no live apps changed'},null,2));
  console.log('HEADLESS BLACKLIST CHECKS PASSED: '+results.length);
} catch(error) {
  console.error(error);console.error(stderr.slice(-2000));
  await fs.writeFile('scratch/blacklist-headless-results.json',JSON.stringify({results,error:error.message},null,2));process.exitCode=1;
} finally {
  socket?.close();chrome.kill();await fixture.dispose();await redisLayer?.close();
}


