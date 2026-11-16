import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
const start=source.indexOf('const getResizedImageUrl = (url, targetWidth = 360) => {');
const end=source.indexOf('\n        };',start);assert.ok(start>=0&&end>start);
const context={};vm.runInNewContext(source.slice(start,end)+'\n};this.resize=getResizedImageUrl;',context);

test('collection responsive resizing keeps one canonical width parameter across repeated resizing',()=>{
 for(const value of ['https://cdn.shopify.com/file.jpg','https://cdn.shopify.com/file.jpg?v=1','https://cdn.shopify.com/file.jpg?v=1&width=360','https://cdn.shopify.com/file.jpg?width=360','https://cdn.shopify.com/file.jpg?v=1&width=360&']){
  const once=context.resize(value,540),twice=context.resize(once,180),url=new URL(twice);
  assert.deepEqual(url.searchParams.getAll('width'),['180']);assert.ok(!twice.includes('&&'));
  assert.equal(context.resize(twice,180),twice);
  if(value.includes('v=1'))assert.equal(url.searchParams.get('v'),'1');
 }
});

test('collection resizing preserves non-Shopify image URLs',()=>{
 for(const value of ['/image/1.svg','https://images.example.com/photo.jpg?width=100'])assert.equal(context.resize(value,540),value);
});
