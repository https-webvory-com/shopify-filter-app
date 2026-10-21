import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';

const merchandising=await loadModule('app/services/merchandising.server.js',{'../db.server.js':{default:{}}});
const full=id=>'gid://shopify/Product/'+id;

for(const compact of [false,true])test(`Black + 2XL keeps eligible explicit pins ahead of tag pins without injecting nonmatches (compact=${compact})`,async()=>{
 const documents=[{id:'1',tags:['Featured'],priceMin:50},{id:'5',tags:[],priceMin:100},{id:'2',tags:[],priceMin:75}];
 const index={search:async(_q,options)=>{
   assert.ok(options.filter.includes('option_Color = "Black"'));
   assert.ok(options.filter.includes('option_Size = "2XL"'));
   return{hits:documents.slice(options.offset,options.offset+options.limit),estimatedTotalHits:documents.length};
 }};
 const value=await prepareCollectionRanking({shop:'fixture',collectionId:'1',sortBy:'best-selling',needsShopifyOrder:true,retainForIdle:false,
   query:{q:'',filter:['shop = "fixture"','option_Color = "Black"','option_Size = "2XL"']},orderedIds:['1','5','2'],pinnedIds:[],
   pinningRule:{products:[{id:full('4')},{id:full('2')},{id:full('5')},{id:full('9')}]},rule:{conditions:[{action:'Pin',field:'Tags',value:'Featured'}]},globalSettings:{},mergedValues:[],
 },{index,prisma:{product:{findMany:async()=>{throw Error('Nonmatching pin must not be hydrated');}}},arrange:merchandising.applyMerchandisingRules,...(compact?{comparator:merchandising.createMerchandisingComparator}:{})});
 assert.deepEqual(value.ids,['2','5','1']);
 assert.equal(value.ids.includes('4'),false);assert.equal(value.ids.includes('9'),false);
});
