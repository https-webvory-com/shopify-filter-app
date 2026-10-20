import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionHeadProofs} from '../../app/utils/collectionHeadProofs.js';
function fixture(){
 const values=new Map(),events=[];let version='a'.repeat(64);
 const redis={get:async k=>values.get(k),setex:async(k,_ttl,v)=>values.set(k,v),del:async k=>values.delete(k)};
 const service=createCollectionHeadProofs({redis,readVersion:async()=>version,observe:e=>events.push(e)});
 const spec={shop:'fixture.myshopify.com',collectionId:'1',revision:'1',sortBy:'best-selling',query:{q:'',filter:['tenant'],country:'IN'},pinnedIds:['1','2','3','4','5']};
 return {service,spec,values,events,version,change:()=>version='b'.repeat(64)};
}
test('shadow comparison matches exactly and consumes its short-lived proof',async()=>{
 const f=fixture();assert.equal(await f.service.remember(f.spec,f.version,['1','2','3','4','5']),true);
 assert.equal(await f.service.compare(f.spec,{ids:['1','2','3','4','5','6']}),'match');
 assert.equal(f.events[0].event,'head-comparison-match');assert.equal(await f.service.compare(f.spec,{ids:[]} ),null);
});
test('a mismatched canonical position is reported and blocks further heads for those inputs',async()=>{
 const f=fixture();await f.service.remember(f.spec,f.version,['1','2','3','4','5']);
 assert.equal(await f.service.compare(f.spec,{ids:['1','2','9','4','5']}),'mismatch');
 assert.equal(f.events[0].position,2);assert.equal(f.events[0].expectedId,'9');assert.equal(f.events[0].servedId,'3');
 assert.equal(await f.service.blocked(f.spec,f.version),true);assert.equal(await f.service.blocked(f.spec,'c'.repeat(64)),false);
});
test('changes in version, market, pins and shop cannot masquerade as a head mismatch',async()=>{
 const f=fixture();await f.service.remember(f.spec,f.version,['1','2','3','4','5']);
 for(const other of [{...f.spec,shop:'other.myshopify.com'},{...f.spec,pinnedIds:['9']},{...f.spec,query:{...f.spec.query,country:'US'}}])assert.equal(await f.service.compare(other,{ids:[]}),null);
 f.change();assert.equal(await f.service.compare(f.spec,{ids:[]}),'changed');assert.equal(f.events[0].event,'head-comparison-skipped');
});
