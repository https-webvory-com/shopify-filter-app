import assert from 'node:assert/strict';
import {createRedisTestLayer} from './redis-layer.mjs';
import {createCollectionDependencies,describeCollectionDependencies} from '../../app/utils/collectionDependencies.js';
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
 console.log('Real Redis dependency isolation, Lua initialization, NX/XX, tag/pin changes and broad fallback PASS');
}finally{await layer.close();}
