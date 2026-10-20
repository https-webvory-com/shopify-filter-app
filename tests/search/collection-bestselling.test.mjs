import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import crypto from 'node:crypto';
import {readCollectionBestSellingIds} from '../../app/utils/collectionBestSelling.js';
import {fetchCollectionPage} from '../../app/utils/collectionPage.js';
test('Shopify order follows every collection page and explicitly requests BEST_SELLING',async()=>{
 const cursors=[];const admin={graphql:async(query,{variables})=>{assert.match(query,/sortKey: BEST_SELLING/);cursors.push(variables.cursor);return {json:async()=>({data:{collection:{products:{nodes:[{id:'gid://shopify/Product/'+(variables.cursor?'2':'1')}],pageInfo:{hasNextPage:!variables.cursor,endCursor:'next'}}}}})};}};
 assert.deepEqual(await readCollectionBestSellingIds(admin,'gid://shopify/Collection/1'),['1','2']);assert.deepEqual(cursors,[null,'next']);
});
test('an incomplete Shopify snapshot is rejected instead of truncating collection access',async()=>{
 await assert.rejects(readCollectionBestSellingIds({graphql:async()=>({json:async()=>({data:{collection:{products:{nodes:[],pageInfo:{hasNextPage:true,endCursor:'same'}}}}})})},'collection'),/Incomplete/);
});
const context={module:{exports:{}},exports:{},console,require:()=>({__esModule:true,default:{}})};
vm.runInNewContext((await transform(await fs.readFile('app/services/merchandising.server.js','utf8'),{format:'cjs'})).code,context);
const apply=context.module.exports.applyMerchandisingRules;
test('pins, price boosts, and remaining products preserve the observed Shopify collection sequence across pages',async()=>{
 // Shopify positions 1-19 after unpublished products are excluded.
 const prices=[2450,1025,2111,2000,1000,2000,2000,2000,1000,629.95,2629.95,785.95,729.95,629.95,949.95,885.95,699.95,2629.95,885.95];
 const docs=prices.map((price,i)=>({id:String(i+1),priceMin:price,title:'Product '+(i+1),bestSellingScore:100-i,variants:[]})).reverse();
 const pins=['1','13'];const boosted=docs.filter(p=>p.priceMin>=1&&p.priceMin<=1000);
 const index={search:async(_q,opts)=>{const list=opts.filter.includes('boosted')?boosted:docs.filter(p=>!boosted.includes(p));return {hits:list.slice(opts.offset,opts.offset+opts.limit)};},getDocument:async id=>docs.find(p=>p.id===id)};
 const tiers=[{query:{q:'',filter:['boosted']},total:boosted.length},{query:{q:'',filter:['ordinary']},total:docs.length-boosted.length}];
 const output=[];
 for(let page=1;page<=4;page++){
  const result=await fetchCollectionPage(index,{page,limit:5,pinnedIds:pins,tiers,attributes:['id'],orderedIds:prices.map((_,i)=>String(i+1))});
  assert.equal(result.total,19);
  const products=result.hits.map((p,i)=>({...p,id:'gid://shopify/Product/'+p.id,_originalIndex:i}));
  const arranged=apply(products,{conditions:[{action:'Boost',field:'Price',minValue:'1',maxValue:'1000'}]},'best-selling',{products:pins.map(id=>({id:'gid://shopify/Product/'+id}))},[],{preserveCollectionBestSellingOrder:true});
  output.push(...arranged.map(p=>p.id.split('/').pop()));
 }
 assert.deepEqual(output,['1','13','5','9','10','12','14','15','16','17','19','2','3','4','6','7','8','11','18']);
 assert.equal(new Set(output).size,19);
});
test('Shopify ranking does not admit products outside the filtered collection or drop new unranked products',async()=>{
 const docs=[{id:'3'},{id:'2'},{id:'1'}];const index={search:async()=>({hits:docs}),getDocument:async id=>docs.find(p=>p.id===id)};
 const result=await fetchCollectionPage(index,{page:1,limit:25,pinnedIds:[],tiers:[{query:{q:'',filter:[]},total:3}],attributes:['id'],orderedIds:['99','1','2']});
 assert.deepEqual(result.hits.map(p=>p.id),['1','2','3']);assert.equal(result.total,3);
});

test('Dynamic Set replaces the preceding score and collection order breaks ties',()=>{
 const conditions=[{action:'Dynamic',field:'Tags',value:'TopFormal',operator:'Set',operand:'99'},{action:'Dynamic',field:'Tags',value:'BestFormal',operator:'Set',operand:'1000'}];
 const products=[{id:'1',tags:['TopFormal','BestFormal'],_originalIndex:0,bestSellingScore:1},{id:'2',tags:['BestFormal'],_originalIndex:1,bestSellingScore:9999},{id:'3',tags:['TopFormal'],_originalIndex:2}];
 const result=apply(products,{conditions},'best-selling',null,[],{preserveCollectionBestSellingOrder:true});
 assert.deepEqual(Array.from(result,p=>p.id),['1','2','3']);
 assert.deepEqual(Array.from(result,p=>p.merchandisingScore),[1000,1000,99]);
});

async function loadOrderService({snapshot=null,fail=false,job=null}={}) {
 const calls=[];let stored=snapshot;
 const mocks={
  'node:crypto':crypto,
  './redis.server.js':{__esModule:true,default:{get:async()=>stored&&JSON.stringify(stored),set:async(_key,value)=>{stored=JSON.parse(value);}}},
  './queue.server.js':{collectionRankingQueue:{add:async(name,data)=>{calls.push({name,data});return {};}},webhookQueue:{getJob:()=>{throw Error('Must not wait on the webhook backlog');},add:()=>{throw Error('Must not enqueue behind webhooks');}},collectionOrderQueue:{getJob:async()=>job,add:async(name,data,opts)=>{calls.push({name,data,opts});if(fail)throw Error('queue unavailable');return {};}}},
  '../shopify.server.js':{unauthenticated:{admin:async()=>({admin:{}})}},
  '../utils/collectionBestSelling.js':{readCollectionBestSellingIds:async()=>{if(fail)throw Error('Shopify unavailable');return ['2','1'];}},
 };
 const ctx={module:{exports:{}},exports:{},Date,warmupHook:async(shop,collectionIds)=>calls.push({name:'COLLECTION_RANKING_WARM',data:{shop,collectionIds}}),console:{error(){}},require:name=>mocks[name]};
 const source=(await fs.readFile('app/services/collectionBestSelling.server.js','utf8')).replace("await import('./collectionPreparation.server.js')",'({scheduleCollectionWarmup:warmupHook})');
 vm.runInNewContext((await transform(source,{format:'cjs'})).code,ctx);
 return {...ctx.module.exports,calls,stored:()=>stored};
}

test('failed worker jobs can recover after their cooldown without losing old order',async()=>{
 let removed=0;
 const job={finishedOn:Date.now()-60000,getState:async()=> 'failed',remove:async()=>{removed++;}};
 const service=await loadOrderService({snapshot:{ids:['1'],updatedAt:1},job});
 const state=await service.getCollectionBestSellingState('shop','collection');
 assert.equal(removed,1);assert.equal(service.calls.length,1);assert.equal(state.refreshState,'waiting');
 assert.deepEqual(Array.from(state.ids),['1']);
});
test('failed worker jobs respect cooldown instead of repeatedly enqueuing',async()=>{
 const service=await loadOrderService({job:{finishedOn:Date.now(),getState:async()=> 'failed'}});
 assert.equal((await service.getCollectionBestSellingState('shop','collection')).status,'failed');
 assert.equal(service.calls.length,0);
});
test('collection updates mark snapshots stale without discarding their IDs',async()=>{
 const service=await loadOrderService({snapshot:{ids:['1'],updatedAt:Date.now()}});
 await service.invalidateCollectionBestSelling('shop','collection');
 assert.equal(service.stored().updatedAt,0);assert.deepEqual(Array.from(service.stored().ids),['1']);
});
test('fresh snapshots serve immediately without scheduling Shopify reads',async()=>{
 const service=await loadOrderService({snapshot:{ids:['1'],updatedAt:Date.now()}});
 const state=await service.getCollectionBestSellingState('shop','collection');
 assert.equal(state.status,'ready');assert.deepEqual(Array.from(state.ids),['1']);assert.equal(service.calls.length,0);
});

test('pending order jobs deduplicate in the dedicated queue without touching webhooks',async()=>{
 for(const queueState of ['waiting','active','delayed','prioritized']) {
  const service=await loadOrderService({job:{opts:{priority:1},getState:async()=>queueState}});
  const state=await service.getCollectionBestSellingState('shop','collection');
  assert.equal(state.status,'pending');assert.equal(state.refreshState,queueState);
  assert.equal(service.calls.length,0);
 }
 const service=await loadOrderService();
 await service.getCollectionBestSellingState('shop','collection');
 assert.equal(service.calls[0].opts.jobId,'collection-order-shop-collection');
 assert.equal(service.calls[0].data.shop,'shop');
 assert.equal(service.calls[0].data.collectionId,'collection');
});

test('background order refreshes yield to cold visitors and are promoted without duplicate jobs',async()=>{
 const cold=await loadOrderService();await cold.getCollectionBestSellingState('shop','collection');
 assert.equal(cold.calls[0].opts.priority,1);
 for(const options of [{snapshot:{ids:['1'],updatedAt:1}},{}]){
  const service=await loadOrderService(options);await service.getCollectionBestSellingState('shop','collection',{warmup:true});
  assert.equal(service.calls[0].opts.priority,10);
 }
 const promotions=[];
 const service=await loadOrderService({job:{opts:{priority:10},getState:async()=> 'prioritized',changePriority:async value=>promotions.push(value.priority)}});
 const state=await service.getCollectionBestSellingState('shop','collection');
 assert.equal(state.status,'pending');assert.deepEqual(promotions,[1]);assert.equal(service.calls.length,0);
});

test('unchanged Shopify refreshes retain the same ranking revision',async()=>{
 const service=await loadOrderService({snapshot:{ids:['2','1'],updatedAt:1}});
 const before=await service.getCollectionBestSellingState('shop','collection');
 await service.refreshCollectionBestSelling('shop','collection');
 const after=await service.getCollectionBestSellingState('shop','collection');
 assert.equal(before.revision,after.revision);
 assert.equal(after.status,'ready');
});
test('stale snapshots remain usable while a durable retrying job refreshes them',async()=>{
 const service=await loadOrderService({snapshot:{ids:['1'],updatedAt:1}});
 const state=await service.getCollectionBestSellingState('shop','collection');
 assert.equal(state.status,'stale');assert.deepEqual(Array.from(state.ids),['1']);assert.equal(service.calls[0].name,'COLLECTION_BEST_SELLING_REFRESH');
 await service.refreshCollectionBestSelling('shop','collection');assert.deepEqual(Array.from(service.stored().ids),['2','1']);
});
test('refresh failures preserve the last successful collection order',async()=>{
 const snapshot={ids:['1'],updatedAt:1};const service=await loadOrderService({snapshot,fail:true});
 await assert.rejects(service.refreshCollectionBestSelling('shop','collection'),/Shopify/);
 assert.deepEqual(service.stored(),snapshot);
 const state=await service.getCollectionBestSellingState('shop','collection');assert.equal(state.status,'stale');assert.equal(state.refreshState,'failed');
});
test('cold collections report pending separately from queue failures',async()=>{
 assert.equal((await (await loadOrderService()).getCollectionBestSellingState('shop','collection')).status,'pending');
 assert.equal((await (await loadOrderService({fail:true})).getCollectionBestSellingState('shop','collection')).status,'failed');
});
test('SoBooster imports retain Dynamic Set operands including zero',async()=>{
 const source=await fs.readFile('app/components/merchandising/ImportMerchandisingRulesModal.jsx','utf8');
 const mapping=source.slice(source.indexOf('  const mapToOurFormat ='),source.indexOf('  const handleNext ='));
 const ctx={};vm.runInNewContext(mapping+'\nthis.mapRule=mapToOurFormat;',ctx);
 const rule=ctx.mapRule({Conditions:JSON.stringify([{Type:'Dynamic',Field:'tags',Value:['TopFormal'],DynamicOperator:'Set',DynamicOperand:99},{Type:'Include',Field:'tags',Value:['TopFormal']},{Type:'Dynamic',Field:'tags',Value:['BestFormal'],DynamicOperator:'Set',DynamicOperand:1000},{Type:'Dynamic',Field:'tags',Value:['Zero'],DynamicOperator:'Set',DynamicOperand:0}])});
 assert.deepEqual(Array.from(rule.conditions,c=>[c.action,c.operator,c.operand]),[['Dynamic','Set','99'],['Include','contains',''],['Dynamic','Set','1000'],['Dynamic','Set','0']]);
});
