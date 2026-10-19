import assert from 'node:assert/strict';
import {createRedisTestLayer} from './redis-layer.mjs';
import {createCollectionFactStore,factStoreKeys} from '../../app/utils/collectionFactStore.js';
import {createCollectionFactProfile,projectCollectionRuleFacts} from '../../app/utils/collectionRuleFacts.js';

const layer=await createRedisTestLayer();
try{
 await layer.worker.pause();
 const store=createCollectionFactStore(layer.redis),shop='facts-test.myshopify.com';
 const profile={...createCollectionFactProfile([{field:'Color (product option)',action:'Boost',value:'Red'}]),revision:1};
 const p={id:'1',variantPrices:[{option1:'Red',available:true}]};
 const facts=projectCollectionRuleFacts(p,profile,()=>({matchType:'exact',imageUrl:'red.jpg'}));
 assert.equal(await store.put(shop,profile,p,facts),1);
 const rows=[{id:'gid://shopify/Product/1',cfpCollectionInputSource:facts.cfpCollectionInputSource}];
 await store.load(shop,profile,rows);assert.deepEqual(rows[0].cfpCollectionFactMatches,facts.cfpCollectionFactMatches);
 assert.equal(rows[0].cfpCollectionFactImages[profile.conditions[0].key],'red.jpg');
 const legacy=projectCollectionRuleFacts(p,profile,()=>false,{backfill:true});
 await store.put(shop,profile,p,legacy);
 await store.load(shop,profile,[{id:'1',cfpCollectionInputSource:facts.cfpCollectionInputSource}]);
 const changed={...p,variantPrices:[{option1:'Blue'}]},next=projectCollectionRuleFacts(changed,profile,()=>false);
 await store.put(shop,profile,changed,next);
 await assert.rejects(store.load(shop,profile,[{id:'1',cfpCollectionInputSource:facts.cfpCollectionInputSource}]),/missing/);
 await store.load(shop,profile,[{id:'1',cfpCollectionInputSource:next.cfpCollectionInputSource}]);
 const bucket=layer.physical(factStoreKeys(shop,profile.id)[0]);
 await layer.client.hset(bucket,'2:legacy','broken');
 await assert.rejects(store.load(shop,profile,[{id:'2'}]),/missing/);
 const otherShop='other-test.myshopify.com';
 await store.put(otherShop,profile,p,facts);
 for(let revision=2;revision<=3;revision++){
  const another={...createCollectionFactProfile([{field:'Color (product option)',action:'Boost',value:String(revision)}]),revision};
  await store.put(shop,another,p,projectCollectionRuleFacts(p,another,()=>false));
 }
 assert.equal(await layer.client.exists(bucket),0);
 assert.equal(await layer.client.exists(layer.physical(factStoreKeys(otherShop,profile.id)[0])),1);
 console.log('PASS: real Redis facts, exact versions, stale backfill isolation, corruption rejection, bounded generations and tenant isolation');
}finally{await layer.close();}
