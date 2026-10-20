import assert from 'node:assert/strict';
import {createRedisTestLayer} from './redis-layer.mjs';
import {createCollectionDependencies,describeCollectionDependencies} from '../../app/utils/collectionDependencies.js';
import {createCollectionSalesDependencies} from '../../app/utils/collectionSalesDependencies.js';
const layer=await createRedisTestLayer();
try{
 const deps=createCollectionDependencies(layer.redis),shop='dependencies-fixture.myshopify.com';
 const descriptor=describeCollectionDependencies({pinnedIds:['12'],rule:{collectionTagMatching:'exact',conditions:[{action:'Include',field:'Tags',value:'TopProm'}]}});
 const before=await deps.revision(shop,descriptor,{initialize:true});assert.ok(before.startsWith('d1.'));
 assert.equal(await deps.revision(shop,descriptor,{initialize:true}),before);
 await deps.changed(shop,{tags:['Unrelated'],ids:['999']});assert.equal(await deps.revision(shop,descriptor),before);
 await deps.changed(shop,{tags:['TopProm'],ids:['999']});assert.notEqual(await deps.revision(shop,descriptor),before);
 const second=await deps.revision(shop,descriptor);await deps.changed(shop,{tags:[],ids:['12']});assert.notEqual(await deps.revision(shop,descriptor),second);
 const third=await deps.revision(shop,descriptor);await deps.changed(shop);assert.notEqual(await deps.revision(shop,descriptor),third);
 assert.equal(await deps.revision('other.myshopify.com',descriptor),null);
 const scores=createCollectionSalesDependencies(layer.redis),spec={shop,needsShopifyOrder:true,sortBy:'best-selling'};
 const epoch=await scores.epoch(shop),saved=await scores.snapshot(spec,{sourceOutsideIds:['12']});
 await scores.changed(shop,['999']);assert.notEqual(await scores.epoch(shop),epoch);assert.equal(await scores.matches(shop,saved),true);
 await scores.changed(shop,['12']);assert.equal(await scores.matches(shop,saved),false);
 const next=await scores.snapshot(spec,{sourceOutsideIds:['12']});await scores.changed(shop,null);assert.equal(await scores.matches(shop,next),false);
 const nativeOnly=await scores.snapshot(spec,{sourceOutsideIds:[]});await scores.changed(shop,['12']);assert.equal(await scores.matches(shop,nativeOnly),true);
 console.log('Real Redis dependency isolation, Lua initialization, NX/XX, tag/pin changes and broad fallback PASS');
}finally{await layer.close();}
