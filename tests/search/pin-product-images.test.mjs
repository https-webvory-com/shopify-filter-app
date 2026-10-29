import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogImageUrls,pinImageUrl} from '../../app/utils/pinProductImages.js';
import {pinProductImageFallbacks} from '../../app/utils/pinProductImageFallbacks.server.js';

test('saved pin image shapes and catalog image lists resolve to usable URLs',()=>{
  assert.equal(pinImageUrl({url:'invalid',src:'https://cdn.shopify.com/good.jpg'}),'https://cdn.shopify.com/good.jpg');
  assert.deepEqual(catalogImageUrls('[{"src":"https://cdn.shopify.com/first.jpg"},"https://cdn.shopify.com/second.jpg"]'),[
    'https://cdn.shopify.com/first.jpg','https://cdn.shopify.com/second.jpg',
  ]);
  assert.deepEqual(catalogImageUrls(['[object Object]',null]),[]);
});

test('pin editor reads current images in one tenant-scoped batch without changing saved pins',async()=>{
  const pins=[{id:'gid://shopify/Product/1',image:'https://old.example/broken.jpg'},{id:'gid://shopify/Product/2',image:null}];
  let calls=0;
  const prisma={product:{findMany:async({where,select})=>{
    calls++;
    assert.equal(where.shop,'shop.myshopify.com');
    assert.deepEqual(where.id.in,pins.map(pin=>pin.id));
    assert.deepEqual(select,{id:true,images:true});
    return [{id:pins[0].id,images:['https://cdn.shopify.com/current.jpg']}];
  }}};
  assert.deepEqual(await pinProductImageFallbacks(prisma,'shop.myshopify.com',pins),{
    [pins[0].id]:['https://cdn.shopify.com/current.jpg'],
  });
  assert.equal(calls,1);
  assert.equal(pins[0].image,'https://old.example/broken.jpg');
});
