import test from 'node:test';
import assert from 'node:assert/strict';
import {isPureCollectionPinReorder,isSafeCollectionPinEdit,reorderVerifiedPinPrefix,activePinsInSavedOrder} from '../../app/utils/collectionPinReorder.js';

const pin=id=>({id:`gid://shopify/Product/${id}`,image:`${id}.jpg`});
const rule=products=>({id:'rule',shop:'fixture.myshopify.com',ruleType:'collection',status:true,
  applyToAll:false,collections:['Dresses'],collectionSortKey:null,products,updatedAt:new Date('2026-01-01')});

test('only an unchanged saved pin set with a different order qualifies',()=>{
 const before=rule([pin(1),pin(2),pin(3)]);
 const reordered={...before,products:[pin(3),pin(1),pin(2)],updatedAt:new Date('2026-01-02')};
 assert.equal(isPureCollectionPinReorder(before,reordered),true);
 assert.equal(isSafeCollectionPinEdit(JSON.parse(JSON.stringify(before)),reordered),true);
 assert.equal(isPureCollectionPinReorder(before,{...reordered,products:[pin(3),pin(1)]}),false);
 assert.equal(isPureCollectionPinReorder(before,{...reordered,products:[{...pin(3),image:'changed.jpg'},pin(1),pin(2)]}),false);
 assert.equal(isPureCollectionPinReorder(before,{...reordered,collections:['Other']}),false);
 assert.equal(isPureCollectionPinReorder(before,{...before,updatedAt:new Date('2026-01-02')}),false);
});

test('one new in-collection pin moves from the base order into saved position',()=>{
 const before=rule([pin(1),pin(2),pin(3)]);
 const after={...before,products:[pin(1),pin(4),pin(2),pin(3)]};
 assert.equal(isSafeCollectionPinEdit(before,after),true);
 assert.equal(isPureCollectionPinReorder(before,after),false);
 assert.deepEqual(reorderVerifiedPinPrefix(['1','2','3','4','5'],before.products.map(p=>p.id),after.products.map(p=>p.id)),['1','4','2','3','5']);
 assert.equal(reorderVerifiedPinPrefix(['1','2','3','5'],before.products.map(p=>p.id),after.products.map(p=>p.id)),null);
});

test('verified prefix reorder preserves every remaining position and refuses noncontiguous pins',()=>{
 const ids=['1','2','3','4','5'];
 assert.deepEqual(reorderVerifiedPinPrefix(ids,[pin(1).id,pin(2).id],[pin(2).id,pin(1).id]),['2','1','3','4','5']);
 assert.equal(reorderVerifiedPinPrefix(ids,[pin(1).id,pin(3).id],[pin(3).id,pin(1).id]),null);
 assert.equal(reorderVerifiedPinPrefix(ids,[pin(1).id,pin(2).id],[pin(1).id,pin(4).id]),null);
 assert.deepEqual(activePinsInSavedOrder(rule([pin(1),pin(2),pin(3)]),[pin(3).id,pin(1).id]),[pin(1).id,pin(3).id]);
});
