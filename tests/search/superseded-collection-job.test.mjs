import test from 'node:test';
import assert from 'node:assert/strict';
import {supersededCollectionJob} from '../../app/utils/supersededCollectionJob.js';
test('retirement identifies only unstarted legacy warmups or explicitly obsolete configuration jobs',()=>{
 const shop='fixture.myshopify.com',job={name:'COLLECTION_RANKING_WARM',data:{shop}};
 for(const state of ['waiting','prioritized','delayed'])assert.equal(supersededCollectionJob(job,shop,'16',state),'legacy-warmup');
 for(const state of ['active','completed','failed','waiting-children','unknown'])assert.equal(supersededCollectionJob(job,shop,'16',state),null);
 for(const other of [{...job,data:{shop:'other.myshopify.com'}},{...job,data:{shop,sweepVersion:2}},{...job,name:'COLLECTION_RANKING_CATALOG'}])assert.equal(supersededCollectionJob(other,shop,'16','waiting'),null);
 const prep={name:'COLLECTION_RANKING_PREPARE',data:{shop,spec:{revision:'15'}}};
 assert.equal(supersededCollectionJob(prep,shop,'16','waiting'),'obsolete-configuration');
 assert.equal(supersededCollectionJob(prep,shop,'15','waiting'),null);
 assert.equal(supersededCollectionJob({...prep,data:{shop,spec:{}}},shop,'16','waiting'),null);
});
