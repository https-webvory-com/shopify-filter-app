import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {DEFAULT_SEARCH_SETTINGS} from '../../app/utils/searchSettings.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assets='extensions/theme-extension/assets/';
const names=['instantSearch.js','searchSettings.js','instantSearch.css','quickView.css','collectionFilterPro.css'];
const files=new Map(await Promise.all(names.map(async name=>[name,await fs.readFile(assets+name,'utf8')])));
const base={title:'Dress "Blue" & Silk',priceMin:20,options:[],variants:[],images:[]};
const products=[
  {...base,id:'1',handle:'modern-image',images:['/cdn/shop/files/dress.avif?v=7']},
  {...base,id:'2',handle:'variant-image',selectedVariantId:'21',variants:[{id:'21',image:{url:'/images/variant.svg'}}]},
  {...base,id:'3',handle:'json-images',images:JSON.stringify([null,{url:'/images/json.svg'}])},
  {...base,id:'4',handle:'broken-primary',images:['/broken-primary.svg','/images/fallback.svg']},
  {...base,id:'5',handle:'broken-secondary',images:['/images/main.svg','/broken-secondary.svg']},
  {...base,id:'6',handle:'blue-only',searchColor:'Blue',selectedVariantId:'61',options:[{name:'Color'}],images:['/images/red.svg'],variants:[{id:'61',option1:'Blue',image:{src:'/images/blue.svg'}},{id:'62',option1:'Red',imageUrl:'/images/red.svg'}]},
];
const imageRequests=[];
let activeSettings={...DEFAULT_SEARCH_SETTINGS,collectionLimit:0};
const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://fixture');
  if(url.pathname==='/api/search-settings'){
    response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');response.end(JSON.stringify({settings:activeSettings}));return;
  }
  if(url.pathname==='/api/search'){
    response.setHeader('Content-Type','application/json');response.end(JSON.stringify({products:products.slice(0,Number(url.searchParams.get('limit')||6)),suggestions:[],globalSettings:{showQuickViewInstantSearch:true,secondImageOnHover:true}}));return;
  }
  if(url.pathname==='/collections.json'||url.pathname==='/search/suggest.json'){
    response.setHeader('Content-Type','application/json');response.end(JSON.stringify({collections:[],resources:{results:{collections:[]}}}));return;
  }
  if(url.pathname.startsWith('/images/')||url.pathname==='/cdn/shop/files/dress.avif'){
    imageRequests.push(request.url);response.setHeader('Content-Type','image/svg+xml');response.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#346699"/></svg>');return;
  }
  const name=url.pathname.slice(1);
  if(files.has(name)){
    response.setHeader('Content-Type',name.endsWith('.css')?'text/css':'text/javascript');
    response.end(name.endsWith('.js')?files.get(name).replaceAll('https://aisearchfilter.webvory.com','http://127.0.0.1:'+server.address().port):files.get(name));return;
  }
  if(url.pathname!=='/'){response.writeHead(404).end();return;}
  const css=url.searchParams.has('collection-last')?['instantSearch.css','quickView.css','collectionFilterPro.css']:['collectionFilterPro.css','instantSearch.css','quickView.css'];
  response.setHeader('Content-Type','text/html');response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${css.map(name=>'<link rel="stylesheet" href="/'+name+'">').join('')}<style>*{box-sizing:border-box}body{margin:0;font:16px Arial}</style><script>
    window.Shopify={shop:'fixture.myshopify.com',country:'US',locale:'en',currency:{active:'USD'},routes:{root:'/'}};
    window.cfpSearchSettings={collectionLimit:0,productLimit:6};window.browserErrors=[];window.quickViewClicks=0;
    addEventListener('error',e=>{if(e.message)browserErrors.push(e.message)});addEventListener('unhandledrejection',e=>browserErrors.push(String(e.reason)));
    window.cfpMarketPricing={apply:async(products,callback)=>{await new Promise(resolve=>setTimeout(resolve,50));products.forEach((product,i)=>callback({...product,priceMin:21},i));}};
    document.addEventListener('click',e=>{if(e.target.closest('.cfp-quick-view-btn')){e.preventDefault();quickViewClicks++;}});
  </script><script src="/searchSettings.js"></script><script src="/instantSearch.js"></script></head><body><header><button aria-label="Search" class="header__icon--search">Search</button></header></body></html>`);
});
let chrome,socket;const results=[];
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const profile=path.resolve('scratch','instant-cards-'+process.pid);await fs.mkdir(profile,{recursive:true});
  chrome=spawn(process.env.HEADLESS_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let stderr='';chrome.stderr.on('data',chunk=>{stderr+=chunk;if(process.argv.includes('--trace'))console.log(String(chunk));});
  for(let i=0;i<100&&!stderr.includes('DevTools listening on');i++)await pause(100);
  const endpoint=stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];if(!endpoint)throw Error('Chrome startup failed');
  const pages=await(await fetch('http://127.0.0.1:'+new URL(endpoint).port+'/json')).json();
  socket=new WebSocket(pages.find(page=>page.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let id=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data),task=pending.get(message.id);if(process.argv.includes('--trace'))console.log('CDP response',message.id??message.method);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);message.error?task.reject(Error(message.error.message)):task.resolve(message.result);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('Timeout: '+method));},15000);pending.set(key,{resolve,reject,timer});if(process.argv.includes('--trace'))console.log('CDP request',key,method);socket.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  const wait=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(100);}throw Error('UI timeout: '+expression);};
  const check=(name,condition=true)=>{assert.ok(condition,name);results.push({name,passed:true});console.log('PASS '+name);};
  const move=async(x,y)=>send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});
  const rect=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  console.log('Browser connected: '+(await send('Browser.getVersion')).product);
  await send('Page.navigate',{url:origin});
  await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  for(const collectionLast of [false,true]){
    await send('Page.navigate',{url:origin+(collectionLast?'/?collection-last':'/')});await wait("!!document.querySelector('#cfp-main-search-input')");
    await evaluate("document.querySelector('header button').click()");
    await wait("document.querySelectorAll('#cfp-search-products .cfp-product-card').length===6");
    await evaluate("(()=>{const input=document.querySelector('#cfp-main-search-input');input.value='dress';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await wait("!document.querySelector('.cfp-skeleton-card')&&document.querySelectorAll('#cfp-search-products .cfp-product-card').length===6");await pause(600);
    await wait("[...document.querySelectorAll('.cfp-main-img')].every(img=>img.complete&&img.naturalWidth>0)");
    const cards=await evaluate("[...document.querySelectorAll('#cfp-search-products .cfp-product-card')].map(card=>({handle:card.querySelector('button').dataset.productHandle,src:card.querySelector('.cfp-main-img').getAttribute('src')}))");
    check('all six image formats/fallbacks load (collection CSS last='+collectionLast+')',cards.length===6);
    check('modern CDN paths retain filenames and use width queries',cards[0].src.includes('/dress.avif?')&&new URL(cards[0].src).searchParams.get('width')==='600');
    check('variant-only and JSON images render',cards[1].src==='/images/variant.svg'&&cards[2].src==='/images/json.svg');
    check('a failed main image recovers to a real product image',cards[3].src==='/images/fallback.svg');
    const first=await rect('.cfp-search-result-card');await move(first.x+first.width/2,first.y+40);await pause(400);
    for(let i=0;i<8;i++){
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.cfp-quick-view-btn')).opacity"),'1');await pause(150);
    }
    check('Quick View stays visible under a stationary pointer for over one second');
    const button=await rect('.cfp-quick-view-btn');await move(button.x+button.width/2,button.y+button.height/2);await pause(400);
    check('Quick View remains the clickable top element',await evaluate(`document.elementFromPoint(${button.x+button.width/2},${button.y+button.height/2})?.classList.contains('cfp-quick-view-btn')`));
    await send('Input.dispatchMouseEvent',{type:'mousePressed',x:button.x+button.width/2,y:button.y+button.height/2,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:button.x+button.width/2,y:button.y+button.height/2,button:'left',clickCount:1});
    check('a real pointer click activates Quick View',await evaluate('quickViewClicks===1'));
    await evaluate('document.activeElement.blur()');
    const title=await rect('.cfp-search-product-title');await move(title.x+title.width/2,title.y+title.height/2);await pause(400);
    check('Quick View stays visible over the title area',await evaluate("getComputedStyle(document.querySelector('.cfp-quick-view-btn')).opacity==='1'"));
    await move(1,950);await pause(400);check('Quick View hides after leaving the card',await evaluate("getComputedStyle(document.querySelector('.cfp-quick-view-btn')).opacity==='0'"));
    await move(first.x+1,first.y+1);await pause(500);check('hovering the card edge keeps its hit area stable',await evaluate("document.querySelector('.cfp-search-result-card').matches(':hover')&&getComputedStyle(document.querySelector('.cfp-quick-view-btn')).opacity==='1'"));
    await evaluate("document.querySelector('[data-product-handle=broken-secondary]').closest('.cfp-product-card').scrollIntoView({block:'center'})");
    const broken=await rect('[data-product-handle=broken-secondary]');await move(broken.x+10,broken.y-40);
    await wait("!document.querySelector('[data-product-handle=broken-secondary]').closest('.cfp-product-card').querySelector('.cfp-secondary-img')");
    check('a broken hover image cannot cover a working main image');
    check('explicit color results keep the matching product image',cards[5].src==='/images/blue.svg');
    assert.deepEqual(await evaluate('browserErrors'),[]);
    if(!collectionLast){const shot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile('scratch/instant-search-hover.png',Buffer.from(shot.data,'base64'));}
  }
  activeSettings={...DEFAULT_SEARCH_SETTINGS,collectionLimit:0,productLimit:3};
  await evaluate("document.querySelector('#cfp-main-search-input').dispatchEvent(new Event('input',{bubbles:true}))");
  await wait("!document.querySelector('.cfp-skeleton-card')&&document.querySelectorAll('#cfp-search-products .cfp-product-card').length===3");
  check('saved product limit applies to the next search without reloading');
  activeSettings=null;
  await evaluate("document.querySelector('#cfp-main-search-input').dispatchEvent(new Event('input',{bubbles:true}))");
  await wait("!document.querySelector('.cfp-skeleton-card')&&document.querySelectorAll('#cfp-search-products .cfp-product-card').length===6");
  check('reset restores defaults on the next search without reloading');
  assert.deepEqual(await evaluate('browserErrors'),[]);
  await send('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});await move(1,800);await pause(400);
  check('mobile Quick View stays visible without hover',await evaluate("[...document.querySelectorAll('.cfp-quick-view-btn')].every(button=>getComputedStyle(button).opacity==='1')"));
  console.log('INSTANT SEARCH BROWSER CHECKS PASSED: '+results.length);
}catch(error){console.error(error);process.exitCode=1;results.push({passed:false,error:error.message});}
finally{await fs.writeFile('scratch/instant-search-browser-results.json',JSON.stringify({environment:'Actual instant-search assets with fixture API/products; fresh headless Chrome, real pointer events',results,imageRequests},null,2));socket?.close();chrome?.kill();server.closeAllConnections();server.close();}
