import test from 'node:test';
import assert from 'node:assert/strict';
import {syncDashboardState,reconcileProductIds} from '../../app/utils/syncDashboard.js';

test('100% scanned is stopped or finalizing until that same run has verified completion',()=>{
 const progress={processed:52735,total:52735};
 const stopped=syncDashboardState({status:'FAILED',progress});assert.equal(stopped.percent,100);assert.equal(stopped.verified,false);assert.match(stopped.label,/sync stopped/);
 const running=syncDashboardState({status:'IN_PROGRESS',queueState:'active',progress});assert.match(running.label,/finalization pending/);assert.equal(running.verified,false);
 const legacy=syncDashboardState({status:'COMPLETED',progress});assert.equal(legacy.verified,false);
 const completed=syncDashboardState({status:'COMPLETED',progress,completedAt:'2026-10-16T00:00:00Z'});assert.equal(completed.verified,true);
});
test('queued, unknown queue, stopped and partial scans have distinct states',()=>{
 const progress={processed:52734,total:52735};
 assert.equal(syncDashboardState({status:'IN_PROGRESS',queueState:'active',progress}).percent,99);
 assert.match(syncDashboardState({status:'IN_PROGRESS',queueState:'waiting',progress}).label,/queued/);
 assert.match(syncDashboardState({status:'IN_PROGRESS',queueState:'unavailable',progress}).label,/unavailable/);
 assert.match(syncDashboardState({status:'IN_PROGRESS',queueState:'missing',progress}).label,/unconfirmed/);
 assert.equal(syncDashboardState({status:'FAILED',progress:{processed:9,total:null}}).percent,null);
 assert.equal(syncDashboardState({status:'IDLE'}).percent,null);
});
const scope={shop:'fixture.myshopify.com',publication:'online-store',status:'ACTIVE',market:null};
const snapshot=ids=>({scope,complete:true,capturedAt:'2026-11-20T00:00:00Z',ids});
test('equal counts with different IDs fail reconciliation; aliases and repeated IDs are canonicalized',()=>{
 const result=reconcileProductIds({shopify:snapshot(['1','2']),database:snapshot(['gid://shopify/Product/1','3','3']),index:snapshot(['1','2'])});
 assert.equal(result.matches,false);assert.deepEqual(result.missingDatabase,['2']);assert.deepEqual(result.extraDatabase,['3']);assert.deepEqual(result.counts,{eligible:2,database:2,index:2});
 assert.deepEqual(result.missingIndex,[]);
});
test('reconciliation distinguishes database gaps, index gaps and stale extras',()=>{
 const result=reconcileProductIds({shopify:snapshot(['1','2','3']),database:snapshot(['1','2']),index:snapshot(['1','4'])});
 assert.deepEqual(result.missingDatabase,['3']);assert.deepEqual(result.missingIndex,['2','3']);assert.deepEqual(result.extraIndex,['4']);
 assert.equal(reconcileProductIds({shopify:snapshot(['1']),database:snapshot(['1']),index:snapshot(['1'])}).matches,true);
});
test('incomplete or differently scoped snapshots never produce a reconciliation claim',()=>{
 const inputs={shopify:snapshot(['1']),database:snapshot(['1']),index:snapshot(['1'])};
 for(const key of ['shop','publication','status','market'])assert.throws(()=>reconcileProductIds({...inputs,index:{...inputs.index,scope:{...scope,[key]:'different'}}}),/identical/);
 assert.throws(()=>reconcileProductIds({...inputs,index:{...inputs.index,complete:false}}),/Complete/);
 assert.throws(()=>reconcileProductIds({...inputs,index:snapshot(['invalid'])}),/Invalid/);
});
