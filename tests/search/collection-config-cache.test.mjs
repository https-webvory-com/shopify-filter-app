import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('pending collection retries reuse the same configuration response',async()=>{
 const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
 const start=source.indexOf('  const collectionConfigurationCache = new Map();');
 const end=source.indexOf('  async function completeCollectionResponse(',start);
 assert.ok(start>0&&end>start);
 let requests=0;
 const context={Map,URL,Date,fetch:async()=>{requests++;return {ok:true,json:async()=>({configurationVersion:'v1',configuration:{}})};}};
 vm.runInNewContext(source.slice(start,end)+'\nthis.read=fetchCollectionConfiguration;',context);
 const signal=new AbortController().signal;
 const url='https://api.test/api/filter?responseProfile=collection-v2&shop=fixture&sortBy=price-ascending';
 assert.equal((await context.read(url,signal)).configurationVersion,'v1');
 assert.equal((await context.read(url,signal)).configurationVersion,'v1');
 assert.equal(requests,1);
});
