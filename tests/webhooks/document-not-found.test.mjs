import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// The meilisearch client reports API error codes on error.cause.code; a check
// on error.code alone never matches, so missing products failed every retry.
const files=['app/workers/webhookWorker.server.js','app/utils/collectionPage.js','app/utils/rankedCollectionPage.js'];

test('every document_not_found check also reads the client error cause',async()=>{
 for(const file of files){
  const source=await fs.readFile(file,'utf8');
  const checks=source.match(/[^\n]{0,80}document_not_found[^\n]{0,10}/g)||[];
  assert.ok(checks.length>0,file);
  for(const check of checks)assert.match(check,/cause\?\.code/,`${file}: ${check}`);
 }
});

test('the webhook product read treats a missing document as absent, not a failure',async()=>{
 const source=await fs.readFile('app/workers/webhookWorker.server.js','utf8');
 const body=source.slice(source.indexOf('const read=async()=>{'),source.indexOf('const before=await read();'));
 const read=new Function('index','productId','shop',`${body.replace('const read=','return ')}`);
 const missing=Object.assign(Error('Document `1` not found.'),{cause:{code:'document_not_found'}});
 assert.equal(await read({getDocument:async()=>{throw missing;}},'gid://shopify/Product/1','s')(),null);
 await assert.rejects(read({getDocument:async()=>{throw Object.assign(Error('down'),{cause:{code:'internal'}});}},'1','s')(),/down/);
});
