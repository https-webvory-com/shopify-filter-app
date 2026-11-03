import { loadRanking } from './helpers/search-ranking.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {transform} from 'esbuild';
import * as color from '../../app/utils/searchColor.js';
import * as skuSearch from '../../app/utils/skuSearch.js';
import {buildSearchSuggestions} from '../../app/utils/searchSuggestions.js';
import {spellingCorrection} from '../../app/utils/spellingCorrection.js';
import {createHash} from 'node:crypto';
import {instantSearchCard,INSTANT_SEARCH_INDEX_FIELDS} from '../../app/utils/instantSearchCard.js';
import {searchCacheHeaders} from '../../app/utils/searchCachePolicy.js';

test('color constraints include compound colors and only configured aliases', () => {
  const colors=['Gold','Slate Blue','Navy','Periwinkle','Textured'];
  assert.deepEqual(color.resolveSearchColor('blue wedding dress for brides mother',colors).values,['Slate Blue']);
  const aliases=[{filterType:'Color',targetValue:'Blue',sourceValues:['Navy','Periwinkle']}];
  assert.deepEqual(color.resolveSearchColor('blue dress',colors,aliases).values,['Slate Blue','Navy','Periwinkle']);
  assert.deepEqual(color.resolveSearchColor('red dress',colors).values,[]);
  assert.equal(color.colorSearchFilter(color.resolveSearchColor('red dress',colors)), 'id = "__no_matching_search_color__"');
  assert.equal(color.colorSearchFilter(color.resolveSearchColor('wedding dress',colors)),null);
});

test('one-edit color typo keeps the catalog color constraint and records the misspelled token', () => {
  const intent = color.resolveSearchColor('blak prom dres', ['Black', 'Red']);
  assert.deepEqual(intent.requested, ['black']);
  assert.deepEqual(intent.queryWords, ['blak']);
  assert.deepEqual(intent.values, ['Black']);
  assert.match(color.colorSearchFilter(intent), /option_Color IN \["Black"\]/);
  assert.deepEqual(color.resolveSearchColor('black prom dress', ['Black']).values, ['Black']);
  assert.deepEqual(color.resolveSearchColor('prom dres', ['Black']).values, []);
});

test('selects an available matching Colour variant and borrows only a same-color image', () => {
  const product={options:JSON.stringify([{name:'Size'},{name:'Colour'}]),variants:[
    {id:'1',option2:'Wine',available:true,imageUrl:'wine.jpg'},
    {id:'2',option2:'Slate Blue',available:false,imageUrl:'blue.jpg'},
    {id:'3',option2:'Slate Blue',available:true,price:55}
  ]};
  const selected=color.selectSearchColorVariant(product,['Slate Blue']);
  assert.equal(selected.id,'3');assert.equal(selected.imageUrl,'blue.jpg');assert.equal(selected.price,55);
  assert.equal(color.selectSearchColorVariant(product,['Gold']),null);
  assert.equal(color.selectSearchColorVariant({...product,variants:[product.variants[0],product.variants[2]]},['Slate Blue']).imageUrl,null);
});

test('a single-color product uses its gallery when its variants have no images', () => {
  const product={options:[{name:'Color'},{name:'Size'}],images:['black-front.jpg','black-back.jpg'],variants:[
    {id:'1',option1:'Black',option2:'2',available:true,imageUrl:null},
    {id:'2',option1:'Black',option2:'4',available:true,imageUrl:null}
  ]};
  assert.equal(color.selectSearchColorVariant(product,['Black'],['black']).imageUrl,'black-front.jpg');
  assert.equal(color.selectSearchColorVariant({...product,variants:[...product.variants,{id:'3',option1:'Red',available:true}]},['Black'],['black']).imageUrl,null);
});

test('blue cannot expand through unrelated merged groups or acquire green, champagne and gold', () => {
  const colors=['Slate Blue','Dusty Blue','Navy','Periwinkle','Deep Green','Champagne','Gold'];
  const aliases=[
    {filterType:'Color',targetValue:'Formal Colors',sourceValues:colors},
    {filterType:'Color',targetValue:'Gold',sourceValues:['Dusty Blue','Champagne']},
    {filterType:'Color',targetValue:'Blue',sourceValues:['Navy','Periwinkle','Deep Green','Champagne','Gold']}
  ];
  const intent=color.resolveSearchColor('blue wedding dress for mother of bride',colors,aliases);
  assert.deepEqual(intent.values,['Slate Blue','Dusty Blue','Navy','Periwinkle']);
  assert.deepEqual(color.resolveSearchColor('blue dress',colors,aliases.slice(0,2)).values,['Slate Blue','Dusty Blue']);
  assert.deepEqual(color.resolveSearchColor('blue dress',colors,[...aliases].reverse()).values,intent.values);
});

test('a literal blue variant wins over an earlier available Navy alias', () => {
  const product={options:[{name:'Color'}],variants:[
    {id:'navy',option1:'Navy',available:true,imageUrl:'navy.jpg'},
    {id:'blue',option1:'Slate Blue',available:true,imageUrl:'blue.jpg'},
    {id:'gold',option1:'Gold',available:true,imageUrl:'gold.jpg'}
  ]};
  const selected=color.selectSearchColorVariant(product,['Slate Blue','Navy'],['blue']);
  assert.equal(selected.id,'blue');assert.equal(selected.imageUrl,'blue.jpg');
});

test('parser facets and color aliases are isolated by shop',async()=>{
  const requests=[];
  const mocks={
    './meiliClient.server.js':{default:{index:()=>({getFilterableAttributes:async()=>['shop','option_Color','option_Colour'],search:async(_q,params)=>{
      requests.push(params);const a=params.filter[0].includes('shop-a');
      return {facetDistribution:{option_Color:a?{'Slate Blue':1,Navy:1,Black:1}:{Gold:1},option_Colour:{},vendor:{},productType:{}}};
    }})}},
    './shopCache.server.js':{getCached:async(_key,fetch)=>fetch()},
    '../db.server':{default:{mergedValue:{findMany:async({where})=>where.shop==='shop-a'?[{filterType:'Color',targetValue:'Blue',sourceValues:['Navy']}]:[]}}},
    '../utils/searchColor.js':color,
    '../utils/skuSearch.js':skuSearch
    ,'./searchIndex.server.js':{getSearchIndexContext:async()=>({settings:null})}
  };
  const context={module:{exports:{}},exports:{},console,require:name=>({__esModule:true,...mocks[name]})};
  vm.runInNewContext((await transform(await fs.readFile('app/services/queryParser.server.js','utf8'),{format:'cjs'})).code,context);
  const a=await context.module.exports.parseQuery('blue dress','shop-a');
  const b=await context.module.exports.parseQuery('blue dress','shop-b');
  const typo=await context.module.exports.parseQuery('blak prom dres','shop-a');
  assert.deepEqual(Array.from(a.filters.colors),['Slate Blue','Navy']);assert.deepEqual(Array.from(b.filters.colors),[]);
  assert.equal(typo.colorQuery,'prom dres');assert.deepEqual(Array.from(typo.filters.colors),['Black']);
  assert.ok(requests.every(request=>request.filter.includes("status = 'ACTIVE'")));
  assert.match(requests[0].filter[0],/shop-a/);assert.match(requests[1].filter[0],/shop-b/);
});

test('instant endpoint constrains semantic retrieval and rejects wrong-color pins',async()=>{
  const intent=color.resolveSearchColor('blue wedding dress',['Slate Blue']);
  const variants=[{id:'1',option1:'Wine',available:true,imageUrl:'wine.jpg'}, {id:'2',option1:'Slate Blue',available:true,imageUrl:'blue.jpg',price:55}];
  const mocks={
    '../services/searchIndex.server.js':{getSearchIndexContext:async()=>({settings:null}),configuredSuggestions:async()=>null},
    '../utils/searchConfiguration.js':{publicSearchProduct:p=>p},
    '../utils/instantSearchCard.js':{instantSearchCard,INSTANT_SEARCH_INDEX_FIELDS},
    '../utils/searchCachePolicy.js':{searchCacheHeaders},
    'node:crypto':{createHash},
    'react-router':{data:(value,init)=>Response.json(value,init)},
    '../utils/searchColor.js':color,'../utils/searchSuggestions.js':{buildSearchSuggestions},'../utils/spellingCorrection.js':{spellingCorrection},
    '../services/queryParser.server.js':{parseQuery:async()=>({colorIntent:intent,colorFilter:color.colorSearchFilter(intent)})},
    '../db.server':{default:{product:{findMany:async()=>[{id:'pin',status:'ACTIVE',options:[{name:'Color'}],variants:[{option1:'Gold'}]}]}}},
    '../services/merchandising.server':{getActivePinningRuleForSearch:async()=>({products:[{id:'pin'}]}),getActiveRuleForSearch:async()=>null},
    '../services/meiliClient.server':{default:{index:()=>({searchForFacetValues:async()=>({facetHits:[]})})}},
    '../services/suggestionBlacklist.server.js':{getActiveSuggestionBlacklist:async()=>[]},
  '../services/filterSettings.server':{},'../services/shopCache.server':{getCached:async key=>key.startsWith('mergedValues')?[]:{}},'../services/rateLimiter.server':{rateLimit:async()=>true},
    '../services/semanticSearch.server':{semanticSearch:async(_q,params)=>{
      assert.ok(params.filter.includes(color.colorSearchFilter(intent)));
      return {hits:[{id:'organic',title:'Evening Dress',status:'ACTIVE',options:[{name:'Color'}],variantPrices:variants,images:['wine.jpg']}]};
    }}
  };
  mocks['../services/searchRanking.server.js'] = await loadRanking(mocks['../db.server'].default, mocks['../services/semanticSearch.server'].semanticSearch);
  const context={module:{exports:{}},exports:{},URL,Response,console,require:name=>({__esModule:true,...mocks[name]})};
  vm.runInNewContext((await transform(await fs.readFile('app/routes/api.search.jsx','utf8'),{loader:'jsx',format:'cjs'})).code,context);
  const response=await context.module.exports.loader({request:new Request('https://fixture/api/search?shop=fixture&q=blue%20wedding%20dress')});
  const data=await response.json();assert.equal(response.status,200);assert.equal(data.products.length,1);
  assert.equal(data.products[0].selectedVariantId,'gid://shopify/ProductVariant/2');
  assert.equal(data.products[0].searchColorImage,'blue.jpg');assert.equal(data.products[0].searchColor,'Slate Blue');
});

test('dropdown renders the selected color image and variant link for a sentence query',async()=>{
  const source=await fs.readFile('extensions/theme-extension/assets/instantSearch.js','utf8');
  const grid={innerHTML:'',querySelectorAll:()=>[]};
  const context={window:{Shopify:{currency:{active:'USD'}}},document:{getElementById:()=>grid},location:{href:'https://shop.test/'},URL,Intl};
  vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  let marketRenderVersion'),source.lastIndexOf('\n});')),context);
  await context.renderProducts({products:[{id:'1',handle:'dress',title:'Dress',options:[{name:'Color'}],selectedVariantId:'2',searchColor:'Slate Blue',searchColorImage:'blue.jpg',merchandisingImage:'wine.jpg',images:['wine.jpg'],variants:[{id:'1',option1:'Wine',imageUrl:'wine.jpg'},{id:'2',option1:'Slate Blue',imageUrl:'blue.jpg'}]}]},'blue wedding dress for brides mother');
  assert.match(grid.innerHTML,/href="\/products\/dress\?variant=2"/);
  assert.match(grid.innerHTML,/src="blue.jpg"/);
});
