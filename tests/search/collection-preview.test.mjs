import test from 'node:test';
import assert from 'node:assert/strict';
import {collectionPreviewPayload,collectionCardsResponse,isPublicCollectionCards} from '../../app/utils/collectionCards.js';
import {collectionCardKey} from '../../app/utils/collectionCardStore.js';

const url='https://api.test/api/filter?shop=fixture.myshopify.com&country=IN&locale=en&collectionHandle=one&sortBy=best-selling&page=1&limit=25&responseProfile=collection-preview-v1';
test('first-row payload preserves ranking and image inputs without prices, facets or bulk configuration',async()=>{
 const payload={rankingToken:'same-token',totalCount:100,settings:[{large:'configuration'}],mergedValues:[{large:'aliases'}],facets:{large:'facets'},globalSettings:{horizontalFilters:true},debug:{collectionRankingStatus:'ready'},
  products:Array.from({length:25},(_,i)=>({id:String(i),title:`Dress ${i}`,handle:`dress-${i}`,vendor:'Vendor',tags:['sale'],priceMin:10,priceMax:20,selectedVariantId:'selected',merchandisingImage:'merch.jpg',
   'metafield_custom.mob_collection_image':{url:'mob.jpg'},options:[{name:'Color',values:['Red']}],images:['main.jpg','hover.jpg'],variants:[{id:'selected',available:true,option1:'Red',imageUrl:'variant.jpg',price:10,inventory:100}]}))};
 const before=JSON.stringify(payload),preview=collectionPreviewPayload(payload);
 assert.deepEqual(preview.products.map(p=>p.id),['0','1','2','3','4']);assert.equal(preview.rankingToken,payload.rankingToken);assert.equal(preview.totalCount,100);
 for(const key of ['settings','mergedValues','facets'])assert.equal(key in preview,false);
 assert.equal('priceMin' in preview.products[0],false);assert.equal('price' in preview.products[0].variants[0],false);
 assert.deepEqual(preview.products[0].variants,[{id:'selected',available:true,option1:'Red',imageUrl:'variant.jpg'}]);
 assert.deepEqual(preview.products[0]['metafield_custom.mob_collection_image'],{url:'mob.jpg'});
 assert.equal(JSON.stringify(payload),before);assert.ok(JSON.stringify(preview).length<before.length/3);
 const result=await collectionCardsResponse(payload,'hit',new Request(url));
 const ready=await result.json();assert.deepEqual(ready.cfpCards,{version:1,preview:true});assert.equal(ready.products.length,25);assert.equal(result.headers.get('Cache-Control'),'no-store');
 const head=await collectionCardsResponse(payload,'hit',new Request(url),{previewLimit:5});assert.equal((await head.json()).products.length,5);
 const complete=await collectionCardsResponse(payload,'hit',new Request(url.replace('collection-preview-v1','collection-cards-v1')));
 assert.equal((await complete.json()).products.length,25);
});

test('preview shares validated card snapshot keys and retains strict anonymous first-page scope',()=>{
 const preview=new Request(url),cards=new Request(url.replace('collection-preview-v1','collection-cards-v1'));
 assert.equal(collectionCardKey(preview),collectionCardKey(cards));assert.equal(isPublicCollectionCards(preview),true);
 for(const extra of ['customer_tags=VIP','tags=red','option_Color=Red','rankingToken=token','page=2'])assert.equal(isPublicCollectionCards(new Request(url+'&'+extra)),false,extra);
});

test('complete previews send saved full-collection filters but omit uncomputed prefix facets',async()=>{
 const payload={rankingToken:'ready',totalCount:100,products:[{id:'1',title:'Dress',handle:'dress'}],settings:[],facets:{options:{Color:[{value:'Black',count:100}]}}};
 const request=new Request(url,{headers:{Accept:'application/x-cfp-pinned-prefix-v3'}});
 const saved=await(await collectionCardsResponse({...payload,cfpCards:{version:1,facetsReady:true}},'hit',request)).json();
 assert.deepEqual(saved.facets,payload.facets);assert.equal(saved.cfpCards.facetsReady,true);
 const notComputed=await(await collectionCardsResponse(payload,'stored',request)).json();assert.equal(notComputed.facets,undefined);
 const prefix=await(await collectionCardsResponse({...payload,collectionPinnedPrefix:{version:2,inputVersion:'a'.repeat(64)}},'prefix',request)).json();
 assert.equal(prefix.facets,undefined);assert.equal(prefix.cfpCards.prefix,true);
});
