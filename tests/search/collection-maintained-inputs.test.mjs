import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionFactStore} from '../../app/utils/collectionFactStore.js';
import {createCollectionFactProfile,collectionInputSource,projectCollectionRuleFacts} from '../../app/utils/collectionRuleFacts.js';
import {maintainCollectionFacts} from '../../app/utils/maintainCollectionFacts.js';
import {loadModule} from './helpers/search-ranking.mjs';

async function fixture(count=80){
 const m=await loadModule('app/services/merchandising.server.js',{'../db.server.js':{default:{}}});
 const shop='fixture',profile={...createCollectionFactProfile([{action:'Boost',field:'Color (product option)',value:'Red'}]),revision:'0'};
 const docs=Array.from({length:count},(_,i)=>({id:String(i+1),shop,status:'ACTIVE',options:[{name:'Color',values:['Red']}],variantPrices:[{option1:'Red',available:true,imageUrl:'red.jpg'}]}));
 for(const doc of docs)doc.cfpCollectionInputSource=collectionInputSource(doc);
 const values=new Map(),calls=[],writes=[];let pipelines=0;
 const redis={eval:async(...args)=>{writes.push(args);values.set(args[2]+':'+args[6]+':'+args[7],args[8]);return 1;},hmget:async(key,...fields)=>fields.map(f=>values.get(key+':'+f)||null)};
 redis.pipeline=()=>{pipelines++;const commands=[];return {eval:(...args)=>commands.push(args),exec:async()=>Promise.all(commands.map(async args=>{try{return [null,await redis.eval(...args)];}catch(error){return [error,null];}}))};};
 const store=createCollectionFactStore(redis),products=()=>docs.map(p=>({id:'gid://shopify/Product/'+p.id,cfpCollectionInputSource:p.cfpCollectionInputSource}));
 const index={getDocuments:async options=>{calls.push(options);const ids=JSON.parse(options.filter.slice(6));return {results:docs.filter(p=>ids.includes(p.id))};}};
 return {m,shop,profile,docs,values,calls,writes,redis,store,index,products,pipelines:()=>pipelines};
}

test('one background fill maintains shared per-product facts and overlapping collections need no variant reads',async()=>{
 const f=await fixture(),products=f.products();
 const deps={store:f.store,index:f.index,prisma:{},shop:f.shop,profile:f.profile,check:f.m.checkRuleMatch};
 await maintainCollectionFacts({...deps,products});
 assert.equal(f.calls.length,4);assert.ok(f.calls.every(q=>q.limit<=25));assert.equal(f.writes.length,80);assert.equal(f.pipelines(),4);
 const overlapping=f.products().slice(20,70);await maintainCollectionFacts({...deps,products:overlapping});
 assert.equal(f.calls.length,4);assert.equal(f.writes.length,80);
 assert.ok(overlapping.every(p=>p.cfpCollectionFactMatches.length===1));
 for(let i=0;i<products.length;i++)assert.deepEqual(products[i].cfpCollectionFactMatches,projectCollectionRuleFacts(f.docs[i],f.profile,f.m.checkRuleMatch,{backfill:true}).cfpCollectionFactMatches);
});

test('matching facts carried by indexed product versions need no Redis read',async()=>{
 const f=await fixture(1),p=f.docs[0];Object.assign(p,projectCollectionRuleFacts(p,f.profile,f.m.checkRuleMatch));
 f.redis.hmget=()=>{throw Error('Redis unavailable');};
 assert.deepEqual(await f.store.load(f.shop,f.profile,[p]),[]);
 p.cfpCollectionFactMatches=['unrecognized:b'];
 await assert.rejects(f.store.load(f.shop,f.profile,[p]),/Redis unavailable/);
});

test('source changes, tenant changes, inactive or missing documents cannot publish guessed facts',async()=>{
 for(const change of ['source','tenant','inactive','missing']){
  const f=await fixture(1),products=f.products();
  if(change==='source')f.docs[0].cfpCollectionInputSource='changed';
  if(change==='tenant')f.docs[0].shop='another';
  if(change==='inactive')f.docs[0].status='DRAFT';
  if(change==='missing'){f.docs.length=0;f.index.getDocument=async()=>{throw Object.assign(Error('missing'),{code:'document_not_found'});};}
  await assert.rejects(maintainCollectionFacts({store:f.store,index:f.index,prisma:{},shop:f.shop,profile:f.profile,products,check:f.m.checkRuleMatch}),/changed|expired/);
  assert.equal(f.writes.length,0,change);
 }
});

test('expired/corrupt/stale facts are repaired only for their exact product version and profile',async()=>{
 const f=await fixture(2),deps={store:f.store,index:f.index,prisma:{},shop:f.shop,profile:f.profile,check:f.m.checkRuleMatch};
 await maintainCollectionFacts({...deps,products:f.products()});const original=f.writes.length;
 const oldField=[...f.values.keys()][0];f.values.set(oldField,'malformed');
 await maintainCollectionFacts({...deps,products:f.products()});assert.equal(f.writes.length,original+1);
 const profile={...createCollectionFactProfile([{action:'Boost',field:'Color (product option)',value:'Blue'}]),revision:'1'};
 await maintainCollectionFacts({...deps,profile,products:f.products()});assert.equal(f.writes.length,original+3);
 assert.ok(f.writes.slice(-2).every(args=>JSON.parse(args[8]).m.length===0));
});

test('retention rejection keeps verified canonical results usable; cancellation prevents population',async()=>{
 const f=await fixture(2);f.redis.eval=async()=>0;
 const products=f.products(),deps={store:f.store,index:f.index,prisma:{},shop:f.shop,profile:f.profile,products,check:f.m.checkRuleMatch};
 await maintainCollectionFacts(deps);assert.ok(products.every(p=>p.cfpCollectionFactMatches.length===1));
 const controller=new AbortController();controller.abort();
 await assert.rejects(maintainCollectionFacts({...deps,signal:controller.signal}));
});

test('SKU facts use tenant-scoped canonical SKU hydration without changing the indexed source marker',async()=>{
 const f=await fixture(2),profile={...createCollectionFactProfile([{field:'SKU',action:'Boost',value:'match-sku'}]),revision:'0'};
 const prisma={variant:{findMany:async({where})=>{
  assert.equal(where.product.shop,f.shop);
  return f.docs.map((p,i)=>({id:p.id+'0',productId:'gid://shopify/Product/'+p.id,sku:i?'other-sku':'match-sku',available:true,price:100}));
 }}};
 const products=f.products();
 await maintainCollectionFacts({store:f.store,index:f.index,prisma,shop:f.shop,profile,products,check:f.m.checkRuleMatch});
 assert.equal(products[0].cfpCollectionFactMatches.length,1);assert.equal(products[1].cfpCollectionFactMatches.length,0);
 assert.ok(products.every((p,i)=>p.cfpCollectionFactSource===f.docs[i].cfpCollectionInputSource));
});
