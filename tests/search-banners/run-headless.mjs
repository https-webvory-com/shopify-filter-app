import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createBannerServer} from './server.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fixture=await createBannerServer();await new Promise(resolve=>fixture.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+fixture.server.address().port;
const profile=path.resolve('scratch','banner-headless-'+process.pid);await fs.mkdir(profile,{recursive:true});
const chrome=spawn(process.env.HEADLESS_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--in-process-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let stderr='',socket;chrome.stderr.on('data',chunk=>stderr+=chunk.toString());
try {
  let endpoint;for(let i=0;i<100;i++){endpoint=stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];if(endpoint)break;if(chrome.exitCode!==null)throw Error('Chrome exited before connecting');await delay(100);}
  if(!endpoint)throw Error('Chrome startup timeout');
  const targets=await(await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json')).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await Promise.race([new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});}),delay(10000).then(()=>{throw Error('Chrome connection timeout');})]);
  let next=0;const pending=new Map();
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(!m.id)return;const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p?.timer);m.error?p?.reject(Error(m.error.message)):p?.resolve(m.result);});
  const send=(method,params={},timeout=15000)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out: '+method));},timeout);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},45000);if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await send('Page.enable');await send('Runtime.enable');
  const version=await send('Browser.getVersion');await send('Page.navigate',{url:origin+'/test-runner'});
  let ready=false;for(let i=0;i<100;i++){if(await evaluate('typeof window.runBannerChecks === "function"')){ready=true;break;}await delay(100);}if(!ready)throw Error('Runner failed to load');
  const results=await evaluate('window.runBannerChecks()');await fs.writeFile('scratch/banner-headless-results.json',JSON.stringify({headless:true,browser:version.product,environment:'Real isolated PostgreSQL; actual editor/service/API/banner assets; fixture authentication and theme grids',results},null,2));
  for(const r of results)console.log((r.passed?'PASS ':'FAIL ')+r.name+(r.error?': '+r.error:''));
  if(results.length!==17||results.some(r=>!r.passed))throw Error('Banner browser checks incomplete or failed');
  console.log('HEADLESS BANNER CHECKS PASSED: '+results.length);
} catch(error) {await fs.writeFile('scratch/banner-headless-failure.json',JSON.stringify({error:error.message}));throw error;}
finally {socket?.close();chrome.kill();await fixture.dispose();}
