import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import {createCollectionFactProfile,projectCollectionRuleFacts,collectionInputSource,collectionFactsCurrent} from '../../app/utils/collectionRuleFacts.js';
import {prepareCollectionRanking} from '../../app/utils/prepareCollectionRanking.js';

const service=()=>loadModule('app/services/merchandising.server.js',{'../db.server.js':{default:{}}});
const conditions=[{action:'Boost',field:'Color (product option)',value:'Burgundy'},
 {action:'Dynamic',field:'Tags',value:'BestBridesmaid',operator:'Set',operand:'100'},
 {action:'Pin',field:'Tags',value:'Champagne'},
 {action:'Boost',field:'SKU',value:'sku-1'},
 {action:'Bury',field:'Discount',minValue:'20',maxValue:'50'},
 {action:'Exclude',field:'Available',minValue:'-999',maxValue:'0'}];
const merged=[{targetValue:'Burgundy',sourceValues:['Wine']}];

test('maintained variant-rule facts preserve all scores, images, pins and ordering without reading variant arrays',async()=>{
 const m=await service(),profile=createCollectionFactProfile(conditions,merged);
 const docs=Array.from({length:12025},(_,i)=>({id:String(i+1),title:'Dress '+i,status:'ACTIVE',priceMin:i===7?0:100+i%50,available:true,inventoryTotal:i%5?-5:10,
  tags:[i%2?'BestBridesmaid':'bestbridesmaid',...(i%3?[]:['Champagne'])],
  options:[{name:'Color',values:['Burgundy','Blue','Wine']}],images:['main.jpg','burgundy.jpg'],
  variantPrices:[{id:i+'01',price:100,compareAtPrice:i%3?110:130,sku:i%7?'other':'sku-1',option1:i%2?'Wine':'Blue',available:i%4!==0,imageUrl:i%5?'wine.jpg':null},
   {id:i+'02',price:110,compareAtPrice:120,sku:'other',option1:'Burgundy',available:i%6!==0,imageUrl:i%3?'burgundy.jpg':null}]}));
 const rule={conditions,collectionTagMatching:'exact',ruleGroups:[{conditions:conditions.slice(0,2)},{conditions:conditions.slice(2)}]};
 const spec={shop:'fixture',query:{q:'',filter:[]},sortBy:'best-selling',retainForIdle:true,needsShopifyOrder:true,orderedIds:docs.map(p=>p.id).reverse(),pinnedIds:['2','3'],pinningRule:{products:[{id:'gid://shopify/Product/2',image:'pinned.jpg'},{id:'gid://shopify/Product/3'}]},rule,mergedValues:merged,globalSettings:{}};
 const facts=new Map(docs.map(p=>[p.id,projectCollectionRuleFacts(p,profile,m.checkRuleMatch)]));
 const calls=[];
 const index={search:async(_q,options)=>{calls.push(options);return {hits:docs.slice(options.offset,options.offset+options.limit).map(p=>Object.fromEntries(options.attributesToRetrieve.filter(f=>f in p).map(f=>[f,p[f]]))),estimatedTotalHits:docs.length};}};
 const deps={index,prisma:{},arrange:m.applyMerchandisingRules,comparator:m.createMerchandisingComparator};
 const baseline=await prepareCollectionRanking(structuredClone(spec),deps);calls.length=0;
 const actual=await prepareCollectionRanking(structuredClone(spec),{...deps,factProfile:profile,loadFacts:async products=>{for(const p of products)Object.assign(p,facts.get(p.id.split('/').pop()));}});
 assert.deepEqual(actual,baseline);assert.equal(calls.length,2);assert.ok(calls.every(q=>!q.attributesToRetrieve.includes('variantPrices')&&!q.attributesToRetrieve.includes('images')&&!q.attributesToRetrieve.includes('options')));
 assert.equal(actual.ids.at(-1),'8');assert.equal(actual.metadata['2'].merchandisingImage,'pinned.jpg');
 for(const sortBy of ['price-ascending','title-descending']){
  const other={...spec,sortBy,needsShopifyOrder:false,orderedIds:null,globalSettings:{prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true}};
  assert.deepEqual(await prepareCollectionRanking(structuredClone(other),{...deps,factProfile:profile,loadFacts:async products=>{for(const p of products)Object.assign(p,facts.get(p.id.split('/').pop()));}}),await prepareCollectionRanking(structuredClone(other),deps));
 }
});

test('fact identities track matching semantics and reject stale product versions, missing facts and new unsupported rules',async()=>{
 const m=await service(),profile=createCollectionFactProfile(conditions,merged);
 assert.equal(profile.id,createCollectionFactProfile([...conditions].reverse().map((c,i)=>({...c,id:String(i),ordinal:i})),merged).id);
 assert.notEqual(profile.id,createCollectionFactProfile(conditions,[{targetValue:'Burgundy',sourceValues:['Red']}]).id);
 const product={id:'1',variantPrices:[{option1:'Burgundy',available:true,imageUrl:'red.jpg'}],options:[],images:[]};
 const old=projectCollectionRuleFacts(product,profile,m.checkRuleMatch,{backfill:true});assert.equal(old.cfpCollectionFactSource,'legacy');assert.ok(collectionFactsCurrent({...product,...old},profile));
 const updated={...product,variantPrices:[{option1:'Blue',available:true,imageUrl:'blue.jpg'}]};
 assert.notEqual(collectionInputSource(product),collectionInputSource(updated));assert.equal(collectionFactsCurrent({...product,...old,cfpCollectionInputSource:collectionInputSource(updated)},profile),false);
 const spec={query:{q:'',filter:[]},sortBy:'best-selling',pinnedIds:[],orderedIds:['1'],rule:{conditions},mergedValues:merged};
 const index={search:async()=>({hits:[{id:'1',priceMin:100}],estimatedTotalHits:1})};
 await assert.rejects(prepareCollectionRanking(spec,{index,prisma:{},arrange:m.applyMerchandisingRules,comparator:m.createMerchandisingComparator,factProfile:profile}),/facts missing/);
 await assert.rejects(prepareCollectionRanking({...spec,rule:{conditions:[{field:'Color (product option)',value:'New color',action:'Boost'}]}},{index,prisma:{},arrange:m.applyMerchandisingRules,comparator:m.createMerchandisingComparator,factProfile:profile}),/do not cover/);
});
