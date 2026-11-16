import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {collectionCardsResponse,collectionPreviewPayload} from '../../app/utils/collectionCards.js';

test('wholesale preview cards retain SKU before the full response arrives',()=>{
 const product={id:'1',title:'Product title',handle:'dress',variants:[{id:'100',sku:'KOS-100',available:true}]};
 const preview=collectionPreviewPayload({products:[product],globalSettings:{isWholesale:true}});
 assert.equal(preview.products[0].variants[0].sku,'KOS-100');
 assert.equal(preview.globalSettings.isWholesale,true);
});

const payload={products:Array.from({length:25},(_,id)=>({id,title:'Formal collection product',variants:Array.from({length:12},(_,size)=>({id:id+'-'+size,price:149,available:true,option1:'Navy',option2:String(size)}))})),totalCount:117,globalSettings:{},rankingToken:'immutable-session'};
test('gzip preserves every product and session field while reducing first-page transfer',async()=>{
 const request=new Request('https://example.com',{headers:{'Accept-Encoding':'br, gzip, deflate'}});
 const response=await collectionCardsResponse(payload,'hit',request);
 assert.equal(response.headers.get('Content-Encoding'),'gzip');
 assert.equal(response.headers.get('Vary'),'Accept-Encoding');
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 const bytes=Buffer.from(await response.arrayBuffer()),plain=await (await collectionCardsResponse(payload)).text();
 assert.equal(gunzipSync(bytes).toString(),plain);
 assert.ok(bytes.length<Buffer.byteLength(plain)/3);
});
test('clients that omit or disable gzip receive ordinary JSON',async()=>{
 for(const encoding of ['', 'br', 'gzip;q=0', 'gzip; q=0.000, br']){
  const request=new Request('https://example.com',{headers:{'Accept-Encoding':encoding}});
  const response=await collectionCardsResponse(payload,'stored',request);
  assert.equal(response.headers.get('Content-Encoding'),null);
  assert.deepEqual((await response.json()).products,payload.products);
 }
});
