import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';

async function fixture() {
 const values=new Map();
 const redis={get:async key=>values.get(key),setex:async(key,ttl,value)=>values.set(key,value)};
 const context={module:{exports:{}},exports:{},console,require:()=>({__esModule:true,default:redis})};
 vm.runInNewContext((await transform(await fs.readFile('app/services/shopCache.server.js','utf8'),{format:'cjs'})).code,context);
 return context.module.exports;
}

test('concurrent cache misses share one expensive ranking preparation',async()=>{
 const {getCached}=await fixture();let calls=0,release;
 const prepare=async()=>{calls++;await new Promise(resolve=>{release=resolve;});return {ids:['1','2']};};
 const a=getCached('ranking',prepare,600),b=getCached('ranking',prepare,600);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 release();assert.deepEqual(await a,await b);
 await getCached('ranking',prepare,600);assert.equal(calls,1);
});

test('failed ranking preparations can be retried',async()=>{
 const {getCached}=await fixture();
 await assert.rejects(getCached('ranking',async()=>{throw Error('search down');}),/search down/);
 assert.equal(await getCached('ranking',async()=>42),42);
});
