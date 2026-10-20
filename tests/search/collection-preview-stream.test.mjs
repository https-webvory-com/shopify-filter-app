import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {gunzipSync} from 'node:zlib';
import {collectionCardsResponse,collectionPreviewPayload} from '../../app/utils/collectionCards.js';

const source=await fs.readFile('extensions/theme-extension/assets/collectionPreviewStream.js','utf8');
const window={};vm.runInNewContext(source,{window,TextDecoder,Uint8Array});
const read=window.cfpReadEarlyResponse,encoder=new TextEncoder();
const payload={rankingToken:'token',totalCount:25,globalSettings:{},debug:{collectionRankingStatus:'ready'},products:Array.from({length:25},(_,i)=>({id:String(i+1),title:'Gown '+i,handle:'gown-'+i,images:['image.jpg'],priceMin:100,variants:[]}))};
const url='https://api.test/api/filter?shop=fixture.myshopify.com&country=IN&locale=en&collectionHandle=one&sortBy=best-selling&page=1&limit=25&responseProfile=collection-preview-v1';
const request=(accept='application/x-ndjson, application/json',encoding='')=>new Request(url,{headers:{Accept:accept,'Accept-Encoding':encoding}});
const decodeRecords=async response=>{
 const raw=Buffer.from(await response.arrayBuffer());
 return (response.headers.get('Content-Encoding')==='gzip'?gunzipSync(raw):raw).toString().trim().split('\n').map(line=>JSON.parse(line));
};
test('negotiated preview sends ranked metadata then every validated card in order, with streamable gzip or ordinary JSON fallback',async()=>{
 for(const encoding of ['', 'gzip','gzip;q=0','gzip;q=0.5']){
  const response=await collectionCardsResponse(payload,'hit',request(undefined,encoding));
  assert.match(response.headers.get('Content-Type'),/^application\/x-ndjson/);assert.equal(response.headers.get('X-Accel-Buffering'),'no');
  assert.equal(response.headers.get('Content-Encoding'),['gzip','gzip;q=0.5'].includes(encoding)?'gzip':null);
  const records=await decodeRecords(response),products=records.filter(r=>r.type==='product').map(r=>r.product);
  assert.equal(records[0].type,'start');assert.equal(records[0].count,25);assert.deepEqual(records.at(-1),{type:'end',count:25});
  assert.deepEqual({...records[0].payload,products},JSON.parse(JSON.stringify(collectionPreviewPayload(payload,{limit:25}))));assert.equal('priceMin' in products[0],false);
 }
 const partial=await decodeRecords(await collectionCardsResponse(payload,'hit',request(),{previewLimit:5}));assert.equal(partial[0].count,5);
 for(const accept of ['application/json','application/x-ndjson;q=0, application/json']){
  const response=await collectionCardsResponse(payload,'hit',request(accept));assert.match(response.headers.get('Content-Type'),/^application\/json/);assert.equal((await response.json()).products.length,25);
 }
});
test('a complete card is delivered while the remainder of the response is still unavailable',async()=>{
 let controller,complete=false;const parts=[];
 const response=new Response(new ReadableStream({start(c){controller=c;}}),{headers:{'Content-Type':'application/x-ndjson'}});
 const result=read(response,r=>parts.push(r)).then(r=>{complete=true;return r;});
 const {products,...metadata}=collectionPreviewPayload(payload,{limit:2});
 controller.enqueue(encoder.encode(JSON.stringify({type:'start',count:2,payload:metadata})+'\n'+JSON.stringify({type:'product',product:products[0]})+'\n'));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(parts.length,1);assert.equal(complete,false);assert.equal(parts[0].payload.products.length,1);
 controller.enqueue(encoder.encode(JSON.stringify({type:'product',product:products[1]})+'\n'+JSON.stringify({type:'end',count:2})+'\n'));controller.close();
 const final=await result;assert.equal(final.payload.products.length,2);assert.equal(parts[0].payload.products.length,1);assert.equal(parts[1].payload.products.length,2);
});
test('UTF-8 and JSON boundaries may split anywhere without changing titles, image selection inputs or order',async()=>{
 const response=await collectionCardsResponse({...payload,products:[{...payload.products[0],title:'Été "red"\n雪'}]},'hit',request());
 const bytes=new Uint8Array(await response.arrayBuffer());
 const chunked=new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}}),{headers:{'Content-Type':'application/x-ndjson'}});
 assert.equal((await read(chunked)).payload.products[0].title,'Été "red"\n雪');
});
test('truncated, duplicate, pending, malformed and out-of-order streams cannot become a complete ready page',async()=>{
 const {products,...metadata}=collectionPreviewPayload(payload,{limit:2});
 const start={type:'start',count:2,payload:metadata},product={type:'product',product:products[0]};
 for(const rows of [[start,product],[start,product,product,{type:'end',count:2}],[product,start],[{...start,payload:{...metadata,debug:{collectionRankingStatus:'pending'}}}],[start,{type:'end',count:2}]]){
  const response=new Response(rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{headers:{'Content-Type':'application/x-ndjson'}});
  await assert.rejects(read(response));
 }
 assert.deepEqual(JSON.parse(JSON.stringify(await read(Response.json({products:[]})))),{status:200,payload:{products:[]}});
 assert.equal((await read(Response.json({debug:{collectionRankingStatus:'pending'}},{status:202}))).status,202);
});
