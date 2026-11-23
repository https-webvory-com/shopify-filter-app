import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createPriceEventHub, priceEventScope, priceEventResponse, PRICE_EVENT_CHANNEL} from '../../app/utils/priceEvents.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const deadline=Date.now()+5000;
  while(!predicate()&&Date.now()<deadline)await pause(10);
  assert.ok(predicate(),'Expected asynchronous price refresh to complete');
}
function subscriber() {
  const client = new EventEmitter();
  client.connect = async () => { client.emit('ready'); };
  client.subscribe = async () => {};
  client.disconnect = () => { client.closed = true; };
  return client;
}
const scope = {shop:'fixture.myshopify.com',country:'GB',currency:'GBP',ids:['1','2']};
test('stream scope rejects invalid tenants, countries, currencies and unbounded product IDs', () => {
  const url = new URL('http://fixture/api/price-events?' + new URLSearchParams({...scope, ids:'1,2,1'}));
  assert.deepEqual(priceEventScope(url), scope);
  for (const [key,value] of [['shop','evil.com'],['country','gb'],['currency','GB'],['ids','1,<script>'],['ids',Array.from({length:501},(_,i)=>i+1).join(',')]]) {
    const bad = new URL(url); bad.searchParams.set(key,value); assert.equal(priceEventScope(bad),null);
  }
});
test('one shared Redis subscriber delivers only the matching tenant and product IDs, and reconnects revalidate', async () => {
  let connections=0; const connection=subscriber(), first=[], second=[];
  const hub=createPriceEventHub(()=>{connections++;return connection;});
  const stop1=hub.subscribe(scope,(...event)=>first.push(event));
  const stop2=hub.subscribe({...scope,shop:'other.myshopify.com'},(...event)=>second.push(event));
  await tick(); assert.equal(connections,1); assert.equal(first[0][0],'ready');
  connection.emit('message',PRICE_EVENT_CHANNEL,JSON.stringify({shop:scope.shop,ids:['1','999']}));
  assert.deepEqual(first.at(-1),['prices',{ids:['1']}]); assert.equal(second.length,1);
  connection.emit('message',PRICE_EVENT_CHANNEL,'invalid');
  connection.emit('close'); connection.emit('ready'); await tick(); assert.equal(first.at(-1)[0],'ready');
  stop1();assert.equal(connection.closed,undefined);stop2();assert.equal(connection.closed,true);
});
test('SSE response streams real frames, bounds slow readers and cleans subscriptions on abort and cancel', async () => {
  let sends, stopped=0;
  const hub={subscribe(_scope,send){sends=send;return()=>stopped++;}};
  const controller=new AbortController();
  const response=priceEventResponse(new Request('http://fixture',{signal:controller.signal}),scope,hub);
  assert.match(response.headers.get('content-type'),/text\/event-stream/);
  assert.equal(response.headers.get('x-accel-buffering'),'no');
  const reader=response.body.getReader(),decode=new TextDecoder();
  assert.match(decode.decode((await reader.read()).value),/retry: 3000/);
  sends('prices',{ids:['1']}); assert.match(decode.decode((await reader.read()).value),/event: prices\ndata: {"ids":\["1"\]}/);
  controller.abort();assert.equal(stopped,1);assert.equal((await reader.read()).done,true);
  const second=priceEventResponse(new Request('http://fixture'),scope,hub);await second.body.cancel();assert.equal(stopped,2);
  const slow=priceEventResponse(new Request('http://fixture'),scope,hub);
  for(let i=0;i<100;i++)sends('prices',{ids:['1']});
  assert.equal(stopped,3);await slow.body.cancel();
});

const source=await fs.readFile('extensions/theme-extension/assets/marketPricing.js','utf8');
function browserFixture({hold=false,missingSaved=false}={}) {
  const connections=[],calls=[],refreshRequests=[],patches=[],changes=[],listeners=new Map(),docListeners=new Map();
  const window={Shopify:{shop:scope.shop,country:'GB',currency:{active:'GBP'},routes:{root:'/'}},addEventListener:(name,fn)=>listeners.set(name,fn)};
  class EventSource {
    constructor(url){this.url=url;this.events=new Map();connections.push(this);}
    addEventListener(name,fn){this.events.set(name,fn);}
    emit(name,data={}){this.events.get(name)?.({data:JSON.stringify(data)});}
    close(){this.closed=true;}
  }
  window.EventSource=EventSource;
  const document={hidden:false,addEventListener:(name,fn)=>docListeners.set(name,fn)};
  let amount=80,release,now=Date.now(),recheck,fail=false,malformed=false,active=0,maximum=0;
  const context={window,document,URLSearchParams,AbortController,setTimeout:(fn,ms)=>{
    if(ms===60000){recheck=fn;return 'recheck';}return setTimeout(fn,ms);
  },clearTimeout:id=>{if(id==='recheck')recheck=null;else clearTimeout(id);},Date:{now:()=>now},console,API_DOMAIN:'http://fixture',fetch:async(url,options)=>{
    if(options.method==='POST'){refreshRequests.push({url,options});return {ok:true};}
    calls.push({url,options});
    const parsed=new URL(url,'http://fixture');
    const id=parsed.pathname.match(/dress-(\d+)\.js/)?.[1];
    const country=window.Shopify.country,currency=window.Shopify.currency.active;
    active++;maximum=Math.max(maximum,active);
    if(hold)await new Promise(resolve=>release=resolve);
    await tick();active--;
    if(fail)throw Error('Shopify unavailable');
    if(parsed.pathname==='/api/market-prices')return {ok:true,json:async()=>({country,currency,products:missingSaved?[]:parsed.searchParams.get('ids').split(',').map(id=>({id:malformed?'999':id,variants:[{id:id+'1',price:amount,compareAtPrice:null,available:true},{id:id+'2',price:amount+10,compareAtPrice:120,available:true}],priceMin:amount,priceMax:amount+10,pricingContext:{source:'saved',country,currency}}))})};
    return {ok:true,json:async()=>({id:malformed?'999':id,price_min:amount*100,price_max:(amount+10)*100,variants:[{id:id+'1',price:amount*100,compare_at_price:null,available:true},{id:id+'2',price:(amount+10)*100,compare_at_price:12000,available:true}]})};
  }};
  vm.runInNewContext(source,context);
  const product=id=>({id,handle:'dress-'+id,variants:[{id:id+'1',price:100,compareAtPrice:120,available:true,sku:'kept'},{id:id+'2',price:110,available:true}],pricingContext:{source:'saved',country:'GB',currency:'GBP'}});
  const watch=(ids,append=false)=>window.cfpMarketPricing.watchCollection(ids.map(product),{shop:scope.shop,append,onPriced:p=>patches.push(p),onChanged:()=>changes.push(true)});
  return {window,document,connections,calls,refreshRequests,patches,changes,listeners,docListeners,watch,product,setAmount:value=>amount=value,setFailure:value=>fail=value,setMalformed:value=>malformed=value,maximum:()=>maximum,recheck:()=>recheck?.(),hasRecheck:()=>!!recheck,advance:ms=>now+=ms,release:()=>release?.(),stop:()=>listeners.get('pagehide')?.()};
}
test('SSE bypasses saved snapshots, coalesces duplicate IDs and patches matching variants without mutating cached cards', async () => {
  const f=browserFixture();try{
    f.watch(['1','2']);const connection=f.connections[0];
    await until(()=>f.patches.length===2);assert.equal(f.patches.length,2,'Initial check reads saved prices without waiting for stream readiness');
    assert.equal(f.refreshRequests.length,1);const refresh=new URL(f.refreshRequests[0].url);
    assert.equal(refresh.searchParams.get('ids'),'1,2');assert.equal(refresh.searchParams.get('country'),'GB');
    assert.equal(f.refreshRequests[0].options.body,undefined,'Amounts must come from authenticated Shopify reads');
    f.calls.length=0;f.patches.length=0;f.changes.length=0;
    f.setAmount(70);
    connection.emit('prices',{ids:['1','999']});connection.emit('prices',{ids:['1']});
    await until(()=>f.patches.length===1);assert.equal(f.calls.length,1);
    const read=new URL(f.calls[0].url);assert.equal(read.pathname,'/api/market-prices');assert.equal(read.searchParams.get('ids'),'1');assert.equal(f.calls[0].options.cache,'no-store');
    assert.equal(f.refreshRequests.length,1,'A completion event must read the committed value without scheduling the same work again');
    assert.equal(f.patches.length,1);assert.equal(f.patches[0].variants[0].price,70);assert.equal(f.patches[0].variants[0].sku,'kept');assert.equal(f.patches[0].variants[1].price,80);
    assert.equal(f.patches[0].variants[1].compareAtPrice,120);
    assert.equal(f.product('1').variants[0].price,100);
    const old=f.product('1');f.window.cfpMarketPricing.latest(old);assert.equal(old.variants[0].price,70);
    f.advance(120000);const older=f.product('1');f.window.cfpMarketPricing.latest(older);assert.equal(older.variants[0].price,70);
    assert.equal(f.changes.length,1);
    f.watch(['1','2']);assert.equal(f.connections.length,1);
  }finally{f.stop();}
});
test('browsers without EventSource retain the existing price renderer without opening connections', async () => {
  const f=browserFixture();delete f.window.EventSource;f.watch(['1']);assert.equal(f.connections.length,0);assert.equal(f.calls.length,0);
  const product=f.product('1');const priced=await f.window.cfpMarketPricing.apply([product]);assert.equal(priced[0].variants[0].price,100);
});

test('a delayed first SSE handshake catches a completed DB update without scheduling a second verification',async()=>{
 const f=browserFixture();try{
  f.watch(['1']);await until(()=>f.patches.at(-1)?.variants[0].price===80);
  f.setAmount(60);f.connections[0].emit('ready');await until(()=>f.patches.at(-1)?.variants[0].price===60);
  assert.equal(f.refreshRequests.length,1);
 }finally{f.stop();}
});
test('a browser refusing EventSource construction does not interrupt card rendering', async () => {
  const f=browserFixture();f.window.EventSource=class {constructor(){throw Error('Blocked by browser');}};
  assert.doesNotThrow(()=>f.watch(['1']));assert.equal(f.calls.length,0);
  const priced=await f.window.cfpMarketPricing.apply([f.product('1')]);assert.equal(priced[0].variants[0].price,100);f.stop();
});
test('reconnect catches missed prices, loaded pages share one stream and saved-price reads stay in batches of 40', async () => {
  const f=browserFixture();try{
    f.watch(Array.from({length:25},(_,i)=>String(i+1)));
    f.watch(Array.from({length:25},(_,i)=>String(i+26)),true);
    assert.equal(f.connections[0].closed,true);
    f.connections.at(-1).emit('ready');await until(()=>f.patches.length===50);
    assert.deepEqual(f.calls.map(c=>new URL(c.url).searchParams.get('ids').split(',').length),[40,10]);
    assert.equal(f.patches.length,50);
    f.setAmount(60);f.connections.at(-1).emit('ready');await until(()=>f.patches.length===100);assert.equal(f.patches.at(-1).variants[0].price,60);
    f.document.hidden=true;f.docListeners.get('visibilitychange')();assert.equal(f.connections.at(-1).closed,true);
    f.document.hidden=false;f.docListeners.get('visibilitychange')();assert.equal(f.connections.length,3);
  }finally{f.stop();}
});

test('missing-country fallback remains bounded to eight Shopify requests at a time',async()=>{
 const f=browserFixture({missingSaved:true});try{
  f.watch(Array.from({length:25},(_,i)=>String(i+1)));await until(()=>f.patches.length===25);
  assert.equal(f.calls.filter(c=>c.url.startsWith('/products/')).length,25);assert.ok(f.maximum()<=8);
 }finally{f.stop();}
});

test('periodic checks catch country changes with no SSE event and stop while hidden', async () => {
  const f=browserFixture();try{
    f.watch(['1']);await until(()=>f.patches.at(-1)?.variants[0].price===80);
    f.setAmount(65);f.recheck();await until(()=>f.patches.at(-1)?.variants[0].price===65);
    assert.equal(f.hasRecheck(),true);
    f.document.hidden=true;f.docListeners.get('visibilitychange')();assert.equal(f.hasRecheck(),false);
    const calls=f.calls.length;f.recheck();await pause(150);assert.equal(f.calls.length,calls);
    f.document.hidden=false;f.docListeners.get('visibilitychange')();f.setAmount(60);await until(()=>f.patches.at(-1)?.variants[0].price===60);
    assert.equal(f.patches.at(-1).variants[0].price,60);
  }finally{f.stop();assert.equal(f.hasRecheck(),false);}
});

test('Shopify failures or mismatched product IDs keep the last verified price, never revert to a saved snapshot', async () => {
  for(const failure of ['network','identity']){
    const f=browserFixture();try{
      f.watch(['1']);await until(()=>f.patches.at(-1)?.variants[0].price===80);
      const count=f.patches.length;
      if(failure==='network')f.setFailure(true);else f.setMalformed(true);
      f.connections[0].emit('prices',{ids:['1']});await pause(180);
      assert.equal(f.patches.length,count);
      const stale=f.product('1');f.window.cfpMarketPricing.latest(stale);assert.equal(stale.variants[0].price,80);
    }finally{f.stop();}
  }
});
test('in-flight responses cannot patch the previous country after a market change', async () => {
  const f=browserFixture({hold:true});try{
    f.watch(['1']);f.connections[0].emit('ready');await until(()=>f.calls.length===1);
    f.window.Shopify.country='IN';f.window.Shopify.currency.active='INR';f.watch(['1']);
    f.release();await tick();assert.equal(f.patches.length,0);assert.equal(f.connections[0].closed,true);
    assert.equal(new URL(f.connections[1].url).searchParams.get('currency'),'INR');
  }finally{f.stop();}
});
