import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source=(await fs.readFile('app/services/sync.server.js','utf8')).replace(/\r\n/g,'\n');
const start=source.indexOf('const PRODUCT_WRITE_WINDOW_MS');
const block=source.slice(start,source.indexOf('export async function syncProductPayload(')).replace('export function','function');
function load(){const context={setTimeout,clearTimeout,Map,Promise,String};vm.runInNewContext(block+';this.queue=queueProductDocumentWrite;',context);return context.queue;}

test('concurrent single-product writes share one engine task and keep the latest copy',async()=>{
 const queue=load(),writes=[];
 const index={uid:'products',addDocuments:async docs=>{writes.push(docs.map(d=>d.id+':'+d.v));return {taskUid:41};}};
 const tasks=await Promise.all([queue(index,[{id:'1',v:'a'}]),queue(index,[{id:'2',v:'a'}]),queue(index,[{id:'1',v:'b'}])]);
 assert.deepEqual(JSON.parse(JSON.stringify(writes)),[['1:b','2:a']]);
 assert.deepEqual(tasks.map(t=>t.taskUid),[41,41,41]);
});

test('a failed shared write rejects every waiting product so each job retries',async()=>{
 const queue=load(),index={uid:'products',addDocuments:async()=>{throw Error('engine down');}};
 const results=await Promise.allSettled([queue(index,[{id:'1'}]),queue(index,[{id:'2'}])]);
 assert.deepEqual(results.map(r=>r.status),['rejected','rejected']);
});

test('a full batch is written at once and a later product starts a new batch',async()=>{
 const queue=load(),writes=[],index={uid:'products',addDocuments:async docs=>{writes.push(docs.length);return {taskUid:writes.length};}};
 const first=Array.from({length:50},(_,i)=>queue(index,[{id:String(i)}]));
 const later=queue(index,[{id:'late'}]);
 await Promise.all([...first,later]);
 assert.deepEqual(writes,[50,1]);
});
