import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadModule} from './helpers/search-ranking.mjs';
import * as facts from '../../app/utils/collectionRuleFacts.js';
import {readCollectionFactRecord} from '../../app/utils/collectionFactStore.js';

async function fixture(){
 const writes=[],jobs=[],conditions=[{action:'Boost',field:'Color (product option)',value:'Red'}];
 let existing=null,docs=[];
 const profile={...facts.createCollectionFactProfile(conditions),revision:'0'};
 const redis={get:async()=>null,set:async()=>true,expire:async()=>true,del:async()=>{},hmget:async(_key,...fields)=>fields.map(()=>null)};
 const queue={getJob:async()=>existing,add:async(...args)=>jobs.push(args)};
 const prisma={session:{findFirst:async()=>({id:'offline'})},merchandisingRule:{findMany:async()=>[{conditions}]},mergedValue:{findMany:async()=>[]},variant:{findMany:async()=>[]}};
 const service=await loadModule('app/services/collectionRuleFacts.server.js',{
  'node:crypto':{createHash},'../db.server.js':{default:prisma},'./redis.server.js':{default:redis},'./meiliClient.server.js':{default:{index:()=>({getDocuments:async()=>({results:docs})})}},
  './shopCache.server.js':{getCached:async(_k,read)=>read()},'./queue.server.js':{collectionRankingQueue:queue},
  './merchandising.server.js':{checkRuleMatch:()=>({matchType:'exact',imageUrl:'red.jpg'})},
  '../utils/prepareCollectionRanking.js':{prepareCollectionRanking:async()=>{throw Error('Unexpected ranking');}},
  '../utils/rankedCollectionPage.js':{hydrateCollectionSkus:async()=>{},readRankedCollectionPage:async(_i,{ids})=>({hits:docs.filter(d=>ids.includes(d.id))})},
  '../utils/collectionRuleFacts.js':facts,'../utils/collectionFactStore.js':{readCollectionFactRecord,createCollectionFactStore:()=>({put:async(...args)=>{writes.push(args);return 1;}})},
  '../config/collection-prewarm.json':{default:[{shop:'owned.myshopify.com'}]},
 });
 return {service,writes,jobs,profile,redis,setExisting:value=>existing=value,setDocs:value=>docs=value};
}
test('fact writes precede index publication and leave other shops unchanged',async()=>{
 const f=await fixture(),p={id:'1',shop:'owned.myshopify.com',variantPrices:[{option1:'Red'}]},other={...p,shop:'other.myshopify.com'};
 const output=await f.service.withCollectionRuleFacts([p,other]);
 assert.equal(f.writes.length,1);assert.equal(output[0].cfpCollectionInputSource,facts.collectionInputSource(p));
 assert.equal(f.writes[0][3].cfpCollectionFactSource,output[0].cfpCollectionInputSource);assert.equal(output[1],other);
});
test('fact sweep recovers a retained failed job and queues at lower priority',async()=>{
 const f=await fixture();let removed=false;
 f.setExisting({getState:async()=>'failed',remove:async()=>removed=true});
 await f.service.scheduleCollectionFactRefresh('owned.myshopify.com');
 assert.ok(removed);assert.equal(f.jobs[0][0],'COLLECTION_FACTS_REFRESH');assert.equal(f.jobs[0][2].priority,5);
});
test('fact sweep reads bounded pages and never changes product source markers',async()=>{
 const f=await fixture();f.setDocs(Array.from({length:100},(_,i)=>({id:String(i+1),shop:'owned.myshopify.com',status:'ACTIVE',variantPrices:[{option1:'Red'}]})));
 const result=await f.service.processCollectionFactRefresh({shop:'owned.myshopify.com',profile:f.profile.id,offset:0});
 assert.equal(result.published,100);assert.equal(f.jobs[0][1].offset,100);
 assert.ok(f.writes.every(row=>row[3].cfpCollectionFactSource==='legacy'&&!('cfpCollectionInputSource' in row[3])));
});
