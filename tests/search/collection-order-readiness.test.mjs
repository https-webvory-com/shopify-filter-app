import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js', 'utf8');
const helper = source.slice(source.indexOf('  function decodeCollectionResponse('), source.indexOf('  async function fetchAndRenderData('));
function load(fetch) {
  const context = { fetch, DOMException, AbortController, setTimeout: (callback,ms) => setTimeout(callback, ms===30000?30000:0), clearTimeout };
  vm.runInNewContext(helper + '\nthis.wait = waitForCollectionOrder;', context);
  return context.wait;
}
const pending = { products: ['fallback'], debug: { collectionBestSellingStatus: 'pending' } };
test('cold collection replaces fallback with Shopify order before rendering', async () => {
  let calls = 0;
  const ready = { products: ['admin-first', 'admin-second'], debug: { collectionBestSellingStatus: 'ready' } };
  const wait = load(async (url, { signal }) => {
    assert.equal(url, '/api/filter?sortBy=best-selling&page=2');
    assert.equal(signal.aborted, false);
    return { ok: true, json: async () => ++calls === 1 ? pending : ready };
  });
  assert.equal(await wait(pending, '/api/filter?sortBy=best-selling&page=2', new AbortController().signal), ready);
  assert.equal(calls, 2);
});
test('ready and stale snapshots do not delay rendering', async () => {
  const wait = load(() => { throw Error('Unexpected request'); });
  for (const status of ['ready', 'stale', 'inactive']) {
    const data = { products:[], debug: { collectionBestSellingStatus: status } };
    assert.equal(await wait(data, '/api/filter', new AbortController().signal), data);
  }
});
test('changing filters cancels a pending collection order request', async () => {
  const controller = new AbortController();
  controller.abort();
  const wait = load(() => { throw Error('Unexpected request'); });
  await assert.rejects(wait(pending, '/api/filter', controller.signal), { name: 'AbortError' });
});
test('unavailable workers cannot cause unlimited polling', async () => {
  let calls = 0;
  const wait = load(async () => { calls++; return { ok: true, json: async () => pending }; });
  await assert.rejects(wait(pending, '/api/filter', new AbortController().signal), /temporarily unavailable/);
  assert.equal(calls, 30);
});

test('failed refreshes are retried instead of rendering fallback products', async () => {
  const ready = { products: ['admin-order'], debug: { collectionBestSellingStatus: 'ready' } };
  const wait = load(async () => ({ ok: true, json: async () => ready }));
  assert.equal(await wait({ ...pending, debug: { collectionBestSellingStatus: 'failed' } }, '/api/filter', new AbortController().signal), ready);
});

test('search failures are surfaced rather than rendered as a successful empty collection', async () => {
  await assert.rejects(load(() => {})({ crash: true, error: 'Search unavailable' }, '/api/filter', new AbortController().signal), /Search unavailable/);
});

test('ready Shopify order still waits for background collection ranking',async()=>{
  const pendingRanking={products:[],debug:{collectionBestSellingStatus:'ready',collectionRankingStatus:'pending'}};
  const ready={products:['pin','boost','ordinary'],debug:{collectionBestSellingStatus:'ready',collectionRankingStatus:'ready'}};
  let calls=0;const wait=load(async()=>{calls++;return {json:async()=>ready};});
  assert.equal(await wait(pendingRanking,'/api/filter',new AbortController().signal),ready);assert.equal(calls,1);
});

test('a malformed successful response cannot look like an empty collection',async()=>{
  const wait=load(()=>{});
  for(const products of [undefined,null,{}])await assert.rejects(wait({products},'/api/filter',new AbortController().signal),/Invalid product response/);
});

for(const stage of ['headers','body'])test(`request timeout aborts stalled ${stage} while preserving the user cancellation signal`,async()=>{
  let timeout;
  const fetch=async(_url,{signal})=>{
    const hang=()=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
    if(stage==='headers')return hang();
    return {status:200,json:hang};
  };
  const context={fetch,DOMException,AbortController,setTimeout:callback=>{timeout=callback;return 1;},clearTimeout:()=>{}};
  vm.runInNewContext(helper,context);
  const controller=new AbortController();const promise=context.fetchCollectionResponse('/api/filter',controller.signal);
  await new Promise(resolve=>setImmediate(resolve));timeout();
  await assert.rejects(promise,{name:'AbortError'});assert.equal(controller.signal.aborted,false);
});

test('proxy HTML failures reject instead of rendering or endlessly polling',async()=>{
  const wait=load(async()=>({status:503,json:async()=>{throw new SyntaxError('Invalid JSON');}}));
  await assert.rejects(wait(pending,'/api/filter',new AbortController().signal),/Invalid JSON/);
});

test('a session expiring during polling signals one automatic restart rather than ordinary Retry',async()=>{
  const wait=load(async()=>({status:409,json:async()=>({error:'Collection ranking session expired',crash:true})}));
  await assert.rejects(wait(pending,'/api/filter',new AbortController().signal),error=>error.collectionSessionExpired===true);
});

test('HTTP failure with an empty products array is still a failure',async()=>{
  const wait=load(async()=>({status:503,json:async()=>({products:[]})}));
  await assert.rejects(wait(pending,'/api/filter',new AbortController().signal),/temporarily unavailable/);
});
