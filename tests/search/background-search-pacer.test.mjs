import test from 'node:test';
import assert from 'node:assert/strict';
import {createPacedFetch} from '../../app/utils/backgroundSearchPacer.js';

const origin='http://engine:7700';
function harness(){
  let clock=0;const log=[],rests=[];const pending=[];
  const base=(url)=>new Promise((resolve,reject)=>pending.push({url:String(url),start:clock,resolve,reject}));
  const sleep=ms=>{rests.push(ms);clock+=ms;return Promise.resolve();};
  return {base,sleep,now:()=>clock,advance:ms=>{clock+=ms;},pending,log,rests};
}
const tick=()=>new Promise(r=>setImmediate(r));

test('engine requests run one at a time and rest half their duration before the next starts',async()=>{
  const h=harness();const paced=createPacedFetch(h.base,origin,{now:h.now,sleep:h.sleep});
  const a=paced(origin+'/indexes/products/documents/fetch'),b=paced(origin+'/indexes/products/search');
  await tick();assert.equal(h.pending.length,1);
  h.advance(400);h.pending[0].resolve('A');assert.equal(await a,'A');
  for(let i=0;i<5;i++)await tick();
  assert.deepEqual(h.rests,[200]);assert.equal(h.pending.length,2);
  h.pending[1].resolve('B');assert.equal(await b,'B');
});

test('rest is capped and other hosts are never delayed or serialized',async()=>{
  const h=harness();const paced=createPacedFetch(h.base,origin,{now:h.now,sleep:h.sleep});
  const a=paced(origin+'/multi-search');await tick();
  const other=paced('https://api.openai.com/v1/embeddings');assert.equal(h.pending.length,2);
  h.pending[1].resolve('O');assert.equal(await other,'O');
  h.advance(10000);h.pending[0].resolve('A');await a;for(let i=0;i<5;i++)await tick();
  assert.deepEqual(h.rests,[1000]);
});

test('a failed request rejects for its caller without blocking later requests',async()=>{
  const h=harness();const paced=createPacedFetch(h.base,origin,{now:h.now,sleep:h.sleep});
  const a=paced(new URL(origin+'/indexes/products/search')),b=paced({url:origin+'/health'});
  await tick();h.pending[0].reject(Error('down'));
  await assert.rejects(a,/down/);for(let i=0;i<5;i++)await tick();
  assert.equal(h.pending.length,2);h.pending[1].resolve('ok');assert.equal(await b,'ok');
});
