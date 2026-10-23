import test from 'node:test';import assert from 'node:assert/strict';
import {createMarketAvailability,marketAvailabilityVersion}from'../../app/utils/marketAvailability.js';
function fixture(){const values=new Map(),jobs=new Map(),requests=[];let revision='one',clock=1000,pages=[{nodes:[{id:'gid://shopify/Product/1',availableForSale:true},{id:'gid://shopify/Product/2',availableForSale:false}],pageInfo:{hasNextPage:false,endCursor:'last'}}];
 const queue={getJob:async id=>jobs.get(id),add:async(name,data,opts)=>{const job={name,data,opts,getState:async()=> 'waiting'};jobs.set(opts.jobId,job);return job;}};
 const service=createMarketAvailability({redis:{get:async k=>values.get(k),setex:async(k,_ttl,v)=>values.set(k,v)},queue,readRevision:async()=>revision,now:()=>clock,fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);requests.push({url,...body});return{ok:true,json:async()=>({data:{products:pages.shift()},extensions:{context:{country:body.variables.country}}})};}});
 return{...service,values,jobs,requests,shop:'fixture.myshopify.com',setPages:p=>pages=p,revision:value=>revision=value,advance:ms=>clock+=ms};}
test('market stock proofs prepare only in the worker and respect the Shopify country context',async()=>{
 const f=fixture();assert.equal(await f.get(f.shop,'IN'),null);assert.equal(f.requests.length,0);assert.equal(f.jobs.size,1);
 await f.get(f.shop,'IN');assert.equal(f.jobs.size,1);const job=[...f.jobs.values()][0];assert.equal(job.name,'COLLECTION_MARKET_AVAILABILITY');
 assert.deepEqual(await f.prepare(job.data),{products:2,available:1});assert.deepEqual(await f.get(f.shop,'IN'),['1']);
 assert.equal(f.requests[0].variables.country,'IN');assert.equal(f.requests[0].url,'https://fixture.myshopify.com/api/2026-07/graphql.json');
 assert.equal(await f.get(f.shop,'US'),null);assert.equal(f.jobs.size,2);
});
test('complete paginated market stock, including an empty market, is cached without guessing quantity',async()=>{
 const f=fixture();f.setPages([{nodes:[{id:'gid://shopify/Product/1',availableForSale:false}],pageInfo:{hasNextPage:true,endCursor:'one'}},{nodes:[{id:'gid://shopify/Product/2',availableForSale:false}],pageInfo:{hasNextPage:false,endCursor:'two'}}]);
 await f.get(f.shop,'IN');await f.prepare([...f.jobs.values()][0].data);assert.deepEqual(await f.get(f.shop,'IN'),[]);assert.equal(f.requests[1].variables.after,'one');
});
test('market stock proofs expire, refresh in the background and cannot survive configuration changes',async()=>{
 const f=fixture();await f.get(f.shop,'IN');await f.prepare([...f.jobs.values()][0].data);
 f.jobs.clear();f.advance(61000);assert.deepEqual(await f.get(f.shop,'IN'),['1']);assert.equal(f.jobs.size,1);
 f.revision('two');assert.equal(await f.get(f.shop,'IN'),null);assert.deepEqual(await f.prepare([...f.jobs.values()][0].data),{superseded:true});
});
test('malformed, duplicate and truncated Shopify pages never become a stock proof',async()=>{
 for(const page of [{nodes:[],pageInfo:{hasNextPage:true,endCursor:'x'}},{nodes:[{id:'gid://shopify/Product/1',availableForSale:true},{id:'gid://shopify/Product/1',availableForSale:false}],pageInfo:{hasNextPage:false}},{nodes:[{id:'invalid',availableForSale:true}],pageInfo:{hasNextPage:false}}]){
  const f=fixture();f.setPages([page]);await f.get(f.shop,'IN');await assert.rejects(f.prepare([...f.jobs.values()][0].data));assert.equal(f.values.size,0);
 }
});
test('availability jobs reject foreign hosts and unsafe countries',async()=>{
 const f=fixture();for(const [shop,country]of [['other.example','IN'],[f.shop,'US)']])await assert.rejects(f.get(shop,country));assert.equal(f.jobs.size,0);assert.equal(f.requests.length,0);
 assert.notEqual(marketAvailabilityVersion(['1']),marketAvailabilityVersion(['1','2']));
});


test('the existing ranking worker dispatches market availability jobs to the stock preparer',async()=>{
 const {processCollectionRankingJob}=await import('../../app/utils/processCollectionRankingJob.js');let received;
 const data={shop:'fixture.myshopify.com',country:'IN',revision:'one'};
 await processCollectionRankingJob({name:'COLLECTION_MARKET_AVAILABILITY',data},{marketAvailability:async input=>{received=input;}});assert.deepEqual(received,data);
});
