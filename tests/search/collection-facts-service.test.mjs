import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {loadModule} from './helpers/search-ranking.mjs';
import * as facts from '../../app/utils/collectionRuleFacts.js';
import {readCollectionFactRecord} from '../../app/utils/collectionFactStore.js';
import {maintainCollectionFacts} from '../../app/utils/maintainCollectionFacts.js';
import {createCollectionCandidateIndex} from '../../app/utils/collectionCandidateIndex.js';

async function fixture(){
 const writes=[],jobs=[],rankingCalls=[],loads=[],conditions=[{action:'Boost',field:'Color (product option)',value:'Red'}];
 let existing=null,docs=[],image='red.jpg',matcherError=false;
 const profile={...facts.createCollectionFactProfile(conditions),revision:'0'};
 const leases=new Map();
 const redis={get:async key=>leases.get(key)||null,set:async(key,value,...args)=>{if(args.includes('NX')&&leases.has(key))return null;leases.set(key,value);return true;},expire:async()=>true,del:async key=>leases.delete(key),hmget:async(_key,...fields)=>fields.map(()=>null)};
 const queue={getJob:async()=>existing,add:async(...args)=>jobs.push(args)};
 const prisma={session:{findFirst:async()=>({id:'offline'})},merchandisingRule:{findMany:async()=>[{conditions}]},mergedValue:{findMany:async()=>[]},variant:{findMany:async()=>[]}};
 const service=await loadModule('app/services/collectionRuleFacts.server.js',{
  'node:crypto':{createHash},'node:buffer':{Buffer},'../db.server.js':{default:prisma},'./redis.server.js':{default:redis},'./meiliClient.server.js':{default:{index:()=>({getDocuments:async()=>({results:docs})})}},
  './shopCache.server.js':{getCached:async(_k,read)=>read()},'./queue.server.js':{collectionRankingQueue:queue},
  './merchandising.server.js':{checkRuleMatch:()=>{if(matcherError)throw Error('Optional fact failure');return {matchType:'exact',imageUrl:image};}},
  '../utils/prepareCollectionRanking.js':{prepareCollectionRanking:async(spec,deps)=>{rankingCalls.push({spec,deps});return {ids:['1'],metadata:{}};}},
  '../utils/rankedCollectionPage.js':{hydrateCollectionSkus:async()=>{},readRankedCollectionPage:async(_i,{ids})=>({hits:docs.filter(d=>ids.includes(d.id))})},
  '../utils/collectionRuleFacts.js':facts,'../utils/maintainCollectionFacts.js':{maintainCollectionFacts},'../utils/collectionCandidateIndex.js':{createCollectionCandidateIndex},
  '../utils/collectionFactStore.js':{readCollectionFactRecord,createCollectionFactStore:()=>({load:async(_shop,_profile,_products,options)=>{loads.push(options);return [];},put:async(...args)=>{writes.push(args);return 1;},putMany:async(shop,profile,rows)=>rows.map(row=>{writes.push([shop,profile,row.product,row.facts]);return 1;})})},
  '../config/collection-prewarm.json':{default:[{shop:'owned.myshopify.com'}]},
 });
 return {service,writes,jobs,profile,redis,rankingCalls,loads,setMatcherError:value=>matcherError=value,setImage:value=>image=value,setExisting:value=>existing=value,setDocs:value=>docs=value};
}
test('fact writes precede index publication and leave other shops unchanged',async()=>{
 const f=await fixture(),p={id:'1',shop:'owned.myshopify.com',variantPrices:[{option1:'Red'}]},other={...p,shop:'other.myshopify.com'};
 const output=await f.service.withCollectionRuleFacts([p,other]);
 assert.equal(f.writes.length,1);assert.equal(output[0].cfpCollectionInputSource,facts.collectionInputSource(p));
 assert.equal(f.writes[0][3].cfpCollectionFactSource,output[0].cfpCollectionInputSource);assert.equal(output[1],other);
 assert.equal(output[0].cfpCollectionFactProfile,f.profile.id);assert.ok(output[0].cfpCollectionFactMatches.length);
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

test('large indexed projections stay bounded and leave the canonical source intact',async()=>{
 const f=await fixture();f.setImage('x'.repeat(8192));
 const product={id:'1',shop:'owned.myshopify.com',variantPrices:[]};
 const [result]=await f.service.withCollectionRuleFacts([product]);
 assert.equal(result.cfpCollectionInputSource,facts.collectionInputSource(product));
 assert.equal(result.cfpCollectionFactProfile,undefined);assert.equal(f.writes.length,1);
});

test('missing-input population runs only in the worker while visitors keep a bounded read-only path',async()=>{
 const f=await fixture(),spec={shop:'owned.myshopify.com',retainForIdle:true,sortBy:'best-selling',needsShopifyOrder:true,orderedIds:['1'],query:{q:''},rule:{conditions:[{action:'Boost',field:'Color (product option)',value:'Red'}]},mergedValues:[]};
 assert.deepEqual(await f.service.prepareCollectionFromFacts(spec),{ids:['1'],metadata:{}});
 await f.rankingCalls[0].deps.loadFacts([]);assert.ok(f.loads[0].signal);assert.equal(f.loads[0].allowMissing,undefined);
 await f.service.prepareCollectionFromFacts(spec,{populate:true});
 await f.rankingCalls[1].deps.loadFacts([]);assert.equal(f.loads[1].signal,undefined);assert.equal(f.loads[1].allowMissing,true);
 assert.equal(await f.service.prepareCollectionFromFacts({...spec,retainForIdle:false}),null);
 const filtered={...spec,retainForIdle:false,directFiltered:true,query:{q:'',filter:["option_Color = 'Red'","option_Size = '8'"]}};
 assert.deepEqual(await f.service.prepareCollectionFromFacts(filtered),{ids:['1'],metadata:{}});
 assert.deepEqual(f.rankingCalls.at(-1).spec.query,filtered.query);
});

test('existing prerequisite jobs are promoted without duplicating the job',async()=>{
 const f=await fixture(),promotions=[];
 f.setExisting({opts:{priority:10},getState:async()=>'prioritized',changePriority:async options=>promotions.push(options.priority)});
 await f.service.scheduleCollectionFactRefresh('owned.myshopify.com');
 assert.deepEqual(promotions,[5]);assert.equal(f.jobs.length,0);
});

test('completed prerequisite sweeps leave catalog worker time instead of immediately rescanning the shop',async()=>{
 const f=await fixture();
 await f.service.processCollectionFactRefresh({shop:'owned.myshopify.com',profile:f.profile.id,offset:0});
 await f.service.scheduleCollectionFactRefresh('owned.myshopify.com');
 assert.equal(f.jobs.length,0);
});

test('optional fact projection failures do not break normal product indexing',async()=>{
 const f=await fixture();f.setMatcherError(true);
 const product={id:'1',shop:'owned.myshopify.com',variantPrices:[]};
 const [result]=await f.service.withCollectionRuleFacts([product]);
 assert.equal(result.id,product.id);assert.equal(result.cfpCollectionInputSource,facts.collectionInputSource(product));
 assert.equal(result.cfpCollectionFactProfile,undefined);assert.equal(f.writes.length,0);
});
