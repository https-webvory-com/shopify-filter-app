import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as lifecycle from '../../app/utils/collectionPreparation.js';

async function fixture() {
  const writes=[];
  const redis={zadd:async(...args)=>writes.push(['add',...args]),zremrangebyrank:async(...args)=>writes.push(['trim',...args]),expire:async(...args)=>writes.push(['expire',...args])};
  const ctx={module:{exports:{}},exports:{},URL,Date,require:name=>{
    if(name==='../utils/collectionPreparation.js')return lifecycle;
    if(name==='../utils/prepareCollectionRanking.js')return {prepareCollectionRanking:()=>{throw Error('Unexpected preparation');}};
    if(name==='./redis.server.js')return {__esModule:true,default:redis};
    return {__esModule:true,default:{}};
  }};
  vm.runInNewContext((await transform(await fs.readFile('app/services/collectionPreparation.server.js','utf8'),{format:'cjs'})).code,ctx);
  return {...ctx.module.exports,writes};
}

test('warmup registry stores a normalized public collection context with a bounded size and lifetime',async()=>{
  const f=await fixture();await f.registerCollectionWarmup('fixture.myshopify.com','https://foreign.example/api/filter?shop=fixture.myshopify.com&collectionHandle=hydrogen&locale=en&country=US&page=1&limit=48');
  const url=new URL(f.writes[0][3]);assert.equal(url.origin,'https://ranking.internal');assert.equal(url.searchParams.get('limit'),'25');
  assert.equal(url.searchParams.get('shop'),'fixture.myshopify.com');assert.equal(url.searchParams.get('country'),'US');
  assert.deepEqual(Array.from(f.writes[1].slice(2)),[0,-21]);assert.equal(f.writes[2][2],86400);
});

test('customer-targeted, filtered, token and later-page requests are never replayed as anonymous warmups',async()=>{
  for(const extra of ['customer_tags=VIP','customerTags=VIP','options[Color][]=Blue','vendor[]=Vendor','rankingToken=token','q=dress','page=2']){
    const f=await fixture();await f.registerCollectionWarmup('fixture.myshopify.com','https://fixture/api/filter?shop=fixture.myshopify.com&collectionHandle=hydrogen&page=1&'+extra);
    assert.equal(f.writes.length,0,extra);
  }
});
