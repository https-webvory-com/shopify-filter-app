import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as crypto from 'node:crypto';
import * as utils from '../../app/utils/marketAvailability.js';

async function fixture(){
  const shop='fixture.myshopify.com',values=new Map(),changes=new Map(),jobs=new Map(),snapshots=new Map(),scans=[],scheduled=[],connectionWrites=[];
  let connected=true,ids=['1','2'],duringScan=null,listReads=0,enabledCountries=['IN','US','GB'],failWarm=false;
  const record={shop,accessToken:'private-test-token',countries:['IN','US','GB'],locale:'en',updatedAt:new Date(1000)};
  const redis={
    get:async key=>values.get(key),
    set:async(key,value,...options)=>{if(options.includes('NX')&&values.has(key))return null;values.set(key,value);return 'OK';},
    setex:async(key,_ttl,value)=>values.set(key,value),
    incr:async key=>{const value=Number(values.get(key)||0)+1;values.set(key,String(value));return value;},
    eval:async(_script,count,...args)=>{
      if(count===1){if(values.get(args[0])===args[1])values.delete(args[0]);return;}
      const epoch=Number(values.get(args[0])||0)+1;values.set(args[0],String(epoch));changes.set(args[2],epoch);return epoch;
    },
    zrangebyscore:async(_key,min,max)=>[...changes].filter(([,epoch])=>epoch>=min&&epoch<=max).map(([id])=>id),
  };
  class Queue{
    on(){}
    async getJob(key){return jobs.get(key);}
    async add(name,data,options){const key=options.jobId;const job={name,data,getState:async()=>job.state||'waiting',remove:async()=>jobs.delete(key)};jobs.set(key,job);}
    async upsertJobScheduler(){}
    async removeJobScheduler(){}
  }
  const database={
    marketStorefrontConnection:{findUnique:async()=>connected?{...record,countries:[...record.countries]}:null,upsert:async value=>connectionWrites.push(value),updateMany:async({data})=>Object.assign(record,data)},
    marketAvailabilitySnapshot:{
      findUnique:async({where,select})=>{if(!select)listReads++;const value=snapshots.get(where.shop_country.country);return !value?null:select?Object.fromEntries(Object.keys(select).map(k=>[k,value[k]])):value;},
      upsert:async({where,create})=>snapshots.set(where.shop_country.country,{...create,updatedAt:new Date()}),
    },
  };
  const mocks={
    'node:crypto':crypto,'bullmq':{Queue},'../db.server.js':{default:database},'./redis.server.js':{default:redis},
    './queue.server.js':{redisOptions:{}},'./shopCache.server.js':{getCached:async(_key,read)=>read()},
    '../utils/marketAvailability.js':{...utils,storefrontQuery:async()=>({localization:{availableCountries:enabledCountries.map(isoCode=>({isoCode})),language:{isoCode:'EN'}},products:{nodes:[{id:'gid://shopify/Product/1'}]}}),readMarketAvailability:async input=>{scans.push(input);if(duringScan)await duringScan();return [...ids];}},
  };
  const source=(await fs.readFile('app/services/marketAvailability.server.js','utf8')).replace("const {scheduleCatalogCollectionWarmups}=await import('./collectionPreparation.server.js');",'').replace("const {invalidateShop}=await import('./shopCache.server.js');",'');
  const context={module:{exports:{}},exports:{},global:{},console,Date,invalidateShop:async()=>{},scheduleCatalogCollectionWarmups:async(...args)=>{scheduled.push(args);if(failWarm){failWarm=false;throw Error('warm queue unavailable');}},require:name=>{
    if(!mocks[name])throw Error('Unexpected import '+name);
    const value=mocks[name];return value.default?{__esModule:true,...value}:value;
  }};
  vm.runInNewContext((await transform(source,{format:'cjs'})).code,context);
  return {service:context.module.exports,shop,values,changes,jobs,scans,scheduled,snapshots,record,connectionWrites,failWarmOnce:()=>failWarm=true,setCountries:value=>enabledCountries=value,setIds:value=>ids=value,onScan:fn=>duringScan=fn,disable:()=>connected=false,listReads:()=>listReads};
}
test('prepared country reads use lightweight proofs and do not call Shopify or load catalog ID lists',async()=>{
  const f=await fixture();assert.equal((await f.service.getMarketAvailabilityState(f.shop,'IN')).status,'pending');
  await f.service.processMarketAvailability({shop:f.shop,country:'IN'});
  const reads=f.listReads(),scans=f.scans.length;
  for(let i=0;i<25;i++)assert.equal((await f.service.getMarketAvailabilityState(f.shop,'IN')).status,'ready');
  assert.equal(f.scans.length,scans);assert.equal(f.listReads(),reads);
  assert.equal(f.scheduled[0][3].countries[0],'IN');
});
test('inventory events invalidate saved eligibility even if global quantity is unchanged and queue every enabled country',async()=>{
  const f=await fixture();await f.service.processMarketAvailability({shop:f.shop,country:'IN'});
  const before=await f.service.getMarketAvailabilityState(f.shop,'IN');
  await f.service.invalidateMarketAvailability(f.shop,'gid://shopify/Product/1');
  assert.equal((await f.service.getMarketAvailabilityState(f.shop,'IN')).status,'pending');
  assert.deepEqual([...new Set([...f.jobs.values()].map(job=>job.data.country))].sort(),['GB','IN','US']);
  f.setIds(['2']);await f.service.processMarketAvailability({shop:f.shop,country:'IN'});
  assert.equal(f.scans.at(-1).changedIds[0],'1');assert.deepEqual([...f.scans.at(-1).previousIds],['1','2']);
  assert.notEqual((await f.service.getMarketAvailabilityState(f.shop,'IN')).version,before.version);
});
test('unchanged country eligibility retains its version and avoids rebuilding collection snapshots',async()=>{
  const f=await fixture();await f.service.processMarketAvailability({shop:f.shop,country:'IN'});
  const before=await f.service.getMarketAvailabilityState(f.shop,'IN'),builds=f.scheduled.length;
  await f.service.invalidateMarketAvailability(f.shop,'2');await f.service.processMarketAvailability({shop:f.shop,country:'IN'});
  assert.equal((await f.service.getMarketAvailabilityState(f.shop,'IN')).version,before.version);assert.equal(f.scheduled.length,builds);
});
test('an update during a country scan cannot publish a current proof, and its retry uses a delta',async()=>{
  const f=await fixture();f.onScan(()=>f.service.invalidateMarketAvailability(f.shop,'1'));
  await assert.rejects(f.service.processMarketAvailability({shop:f.shop,country:'IN'}),/changed during/);
  assert.equal((await f.service.getMarketAvailabilityState(f.shop,'IN')).status,'pending');
  f.onScan(null);await f.service.processMarketAvailability({shop:f.shop,country:'IN'});
  assert.equal(f.scans.at(-1).changedIds[0],'1');assert.equal((await f.service.getMarketAvailabilityState(f.shop,'IN')).status,'ready');
  assert.equal(f.scheduled.length,1,'a recovered first scan must queue saved collections even if the eligible IDs did not change');
});
test('unconnected shops retain existing behavior and invalid country requests cannot enqueue work',async()=>{
  const f=await fixture();f.disable();assert.equal((await f.service.getMarketAvailabilityState(f.shop,null)).status,'disabled');assert.equal(f.jobs.size,0);
  const g=await fixture();await assert.rejects(g.service.getMarketAvailabilityState(g.shop,'ZZ'),/not enabled/);
  await assert.rejects(g.service.getMarketAvailabilityState(g.shop,'invalid'),/Invalid market/);assert.equal(g.jobs.size,0);
});
test('token setup requires actual Shopify permission, reuses its own token and keeps it out of its result',async()=>{
  const f=await fixture();let granted=false,mutations=0;
  const admin={graphql:async source=>{
    if(source.includes('mutation')){mutations++;throw Error('must reuse the existing token');}
    assert.ok(source.includes('shop{storefrontAccessTokens'));
    return {json:async()=>({data:{currentAppInstallation:{accessScopes:granted?[{handle:'unauthenticated_read_product_listings'}]:[]},shop:{storefrontAccessTokens:{nodes:[{title:'Collection Filter Pro country availability',accessToken:'private-test-token'}]}}}})};
  }};
  await assert.rejects(f.service.connectMarketAvailability(f.shop,admin),/Approve/);assert.equal(f.connectionWrites.length,0);
  granted=true;const result=await f.service.connectMarketAvailability(f.shop,admin);
  assert.equal(result.countries,3);assert.equal(mutations,0);assert.equal(f.connectionWrites[0].where.shop,f.shop);
  assert.ok(!JSON.stringify(result).includes('private-test-token'));assert.equal(f.jobs.size,3);
});
test('new countries are discovered without invalidating unchanged prepared countries',async()=>{
  const f=await fixture();await f.service.processMarketAvailability({shop:f.shop,country:'IN'});
  const before=await f.service.getMarketAvailabilityState(f.shop,'IN');
  f.setCountries(['IN','US','CA']);await f.service.discoverMarketCountries({shop:f.shop});
  assert.equal((await f.service.getMarketAvailabilityState(f.shop,'IN')).version,before.version);
  assert.ok([...f.jobs.values()].some(job=>job.data.country==='CA'));
  await assert.rejects(f.service.getMarketAvailabilityState(f.shop,'GB'),/not enabled/);
});
test('a failed country publication scheduling step retries without repeating the stock scan',async()=>{
  const f=await fixture();f.failWarmOnce();
  await assert.rejects(f.service.processMarketAvailability({shop:f.shop,country:'IN'}),/warm queue/);
  await f.service.processMarketAvailability({shop:f.shop,country:'IN'});
  assert.equal(f.scans.length,1);assert.equal(f.scheduled.length,2);
});
