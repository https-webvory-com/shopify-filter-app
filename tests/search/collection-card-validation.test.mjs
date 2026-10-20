import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCollectionCardDocuments} from '../../app/utils/collectionCardValidation.js';
import {collectionPageFingerprint} from '../../app/utils/collectionResponse.js';

function fixture(){
 const docs=Array.from({length:25},(_,i)=>({id:String(i+1),shop:'fixture.myshopify.com',status:'ACTIVE',title:'Dress '+i,variants:[{id:String(100+i),available:true}]}));
 const calls=[],index={getDocuments:async query=>{calls.push(query);return {results:docs.slice(0,query.limit)}}};
 return {docs,calls,index,entry:{shop:'fixture.myshopify.com',attributes:['id','shop','status','title','variants'],validationFingerprint:collectionPageFingerprint(docs),previewValidationFingerprint:collectionPageFingerprint(docs.slice(0,5))},prepared:{ids:docs.map(p=>p.id)}};
}
test('a five-card preview validates exactly its documents, while the complete page validates all 25',async()=>{
 const f=fixture();assert.equal(await validateCollectionCardDocuments(f.index,f.entry,f.prepared,{preview:true}),true);assert.equal(f.calls[0].limit,5);
 f.docs[10].title='Changed later card';
 assert.equal(await validateCollectionCardDocuments(f.index,f.entry,f.prepared,{preview:true}),true);
 assert.equal(await validateCollectionCardDocuments(f.index,f.entry,f.prepared),false);assert.equal(f.calls.at(-1).limit,25);
 f.docs[0].variants[0].available=false;
 assert.equal(await validateCollectionCardDocuments(f.index,f.entry,f.prepared,{preview:true}),false);
});
test('older snapshots keep complete validation and invalid or foreign head products never pass',async()=>{
 const f=fixture();delete f.entry.previewValidationFingerprint;
 assert.equal(await validateCollectionCardDocuments(f.index,f.entry,f.prepared,{preview:true}),true);assert.equal(f.calls[0].limit,25);
 f.docs[0].status='DRAFT';await assert.rejects(()=>validateCollectionCardDocuments(f.index,f.entry,f.prepared,{preview:true}),/eligibility/);
 f.docs[0].status='ACTIVE';f.docs[0].shop='foreign.myshopify.com';await assert.rejects(()=>validateCollectionCardDocuments(f.index,f.entry,f.prepared,{preview:true}),/tenant/);
});
