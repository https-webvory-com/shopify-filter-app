import test from 'node:test';import assert from 'node:assert/strict';
import {readRankedCollectionPage} from '../../app/utils/rankedCollectionPage.js';
import http from 'node:http';import {Meilisearch} from 'meilisearch';
const shop='fixture.myshopify.com',docs=Array.from({length:60},(_,i)=>({id:String(i+1),shop,status:'ACTIVE',title:'Dress '+(i+1)}));
const options={ids:docs.map(p=>p.id).reverse(),page:1,limit:25,attributes:['id','shop','status','title'],shop};

test('one bounded batch replaces25 reads and restores frozen order even when documents arrive in another order',async()=>{
 let calls=0;
 const index={getDocuments:async query=>{calls++;assert.equal(query.limit,25);assert.equal(query.offset,0);assert.ok(query.fields.includes('shop'));const ids=JSON.parse(query.filter.slice(6));return {results:docs.filter(p=>ids.includes(p.id)),total:60};},getDocument:()=>{throw Error('Unexpected individual read');}};
 const page=await readRankedCollectionPage(index,options);assert.equal(calls,1);assert.deepEqual(page.hits.map(p=>p.id),options.ids.slice(0,25));assert.equal(page.total,60);
});
test('missing and server-capped records are checked individually without changing page slots',async()=>{
 const calls=[],index={getDocuments:async()=>({results:[docs[2]],limit:1,total:60}),getDocument:async id=>{calls.push(id);if(id==='2')throw Object.assign(Error('gone'),{code:'document_not_found'});return docs.find(p=>p.id===id);}};
 const page=await readRankedCollectionPage(index,{...options,ids:['3','2','1'],limit:3});assert.deepEqual(calls,['2','1']);assert.deepEqual(page.hits,[docs[2],{id:'2'},docs[0]]);assert.equal(page.total,3);
});
test('bulk pages retain tenant and active-product checks and reject unrelated or duplicate documents',async()=>{
 for(const product of [{...docs[0],shop:'other.myshopify.com'},{...docs[0],status:'ARCHIVED'}])await assert.rejects(readRankedCollectionPage({getDocuments:async()=>({results:[product]})},{...options,ids:['1']}),/session expired/);
 for(const results of [[docs[1]],[docs[0],docs[0]]])await assert.rejects(readRankedCollectionPage({getDocuments:async()=>({results})},{...options,ids:['1']}),/Invalid collection document batch/);
});
test('unsupported bulk filters preserve older-server reads and cache the capability on the shared client',async()=>{
 const owner={},calls=[];const index=()=>({getDocuments:async()=>{calls.push('bulk');throw Object.assign(Error('not filterable'),{code:'invalid_document_filter'});},getDocument:async id=>{calls.push(id);return docs.find(p=>p.id===id);}});
 for(let i=0;i<2;i++)assert.deepEqual((await readRankedCollectionPage(index(),{...options,ids:['2','1'],batchOwner:owner})).hits,[docs[1],docs[0]]);
 assert.deepEqual(calls,['bulk','2','1','2','1']);
});
test('transient failures are surfaced and a page outside the sequence makes no bulk request',async()=>{
 await assert.rejects(readRankedCollectionPage({getDocuments:async()=>{throw Error('network offline');}},{...options,ids:['1']}),/network offline/);
 assert.deepEqual(await readRankedCollectionPage({getDocuments:()=>{throw Error('unexpected');}},{...options,page:100}),{hits:[],total:60});
});

test('the installed SDK sends one read-only documents/fetch request with a filter instead of the unsupported ids parameter',async()=>{
 const requests=[];
 const server=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push({method:req.method,path:req.url,body});res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({results:[docs[0],docs[1]],offset:0,limit:2,total:60}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const client=new Meilisearch({host:'http://127.0.0.1:'+server.address().port});
  const page=await readRankedCollectionPage(client.index('products'),{...options,ids:['2','1'],limit:2,batchOwner:client});
  assert.deepEqual(page.hits,[docs[1],docs[0]]);assert.equal(requests.length,1);assert.equal(requests[0].method,'POST');assert.equal(requests[0].path,'/indexes/products/documents/fetch');assert.equal(requests[0].body.ids,undefined);assert.equal(requests[0].body.filter,'id IN ["2","1"]');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
