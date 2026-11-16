import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile('extensions/theme-extension/assets/collectionFilterPro.js','utf8');
const complete=source.slice(source.indexOf('  async function completeCollectionFacets'),source.indexOf('  function applyGlobalSettings'));
const meta={version:1,sortBy:'price-ascending',collectionId:'gid://shopify/Collection/1'};
async function read(cards,full){
 const calls={renders:0,errors:0,requests:[]};const node=()=>({classList:{remove(){}},append(){},addEventListener(){},setAttribute(){}});
 const sidebar={...node(),querySelectorAll:()=>[],querySelector:()=>null,prepend:()=>calls.errors++};
 const context={URL,sidebar,globalSettings:{},cfpLastSettings:[],cfpLastFacets:{},cfpLastTotalCount:0,window:{},document:{createElement:node},wishlistProducts:new Map(),
  fetchCollectionResponse:async url=>{calls.requests.push(new URL(url));return {status:200,json:async()=>full};},
  renderFilterSidebar:()=>calls.renders++,renderBreadcrumbs(){},updateActiveCountBadge(){},updatePriceSortNotice(){},updateProductCount(){},renderPagination(){},syncWishlistProducts(){},saveBrowserResult(){},
  getProductContainer:()=>({querySelectorAll:()=>[]}),renderProducts:async()=>{},collectionRankingTokens:new Map(),activeFilters:{},
 };
 vm.createContext(context);vm.runInContext(complete,context);
 await context.completeCollectionFacets(cards,'https://fixture/api/filter?shop=fixture.myshopify.com&collectionId=1&sortBy=price-ascending&responseProfile=fast-cards-v1',{aborted:false},false,'key');return calls;
}
const cards=(extra={})=>({products:[{id:'1'}],rankingToken:null,cfpCards:{version:2,preview:true,directSort:meta},...extra});
const full=(extra={})=>({products:[{id:'1'}],rankingToken:null,settings:[{filterType:'price'}],facets:{priceRanges:{ranges:[{min:0,max:50,count:4}]}},totalCount:25,cfpDirectSort:meta,...extra});
test('direct price-sort cards accept canonical filters without a ranking token',async()=>{
 const result=await read(cards(),full());assert.equal(result.renders,1);assert.equal(result.errors,0);
 assert.equal(result.requests[0].searchParams.has('rankingToken'),false);assert.equal(result.requests[0].searchParams.get('responseProfile'),'collection-v1');
});
test('filtered direct sorts use complete canonical filters rather than a token-only facet request',async()=>{
 const result=await read(cards({cfpCards:{version:2,preview:true,filtered:true,directSort:meta}}),full());assert.equal(result.renders,1);assert.equal(result.requests[0].searchParams.get('responseProfile'),'collection-v1');
});
test('direct sort filters also support the virtual all-products collection',async()=>{
 const all={...meta,collectionId:null};const result=await read(cards({cfpCards:{version:2,preview:true,directSort:all}}),full({cfpDirectSort:all}));assert.equal(result.renders,1);assert.equal(result.errors,0);
});
for(const change of [{version:2},{sortBy:'price-descending'},{collectionId:'gid://shopify/Collection/2'}])test('direct facet response rejects a changed protocol/sort/collection '+JSON.stringify(change),async()=>{
 const result=await read(cards(),full({cfpDirectSort:{...meta,...change}}));assert.equal(result.renders,0);assert.equal(result.errors,1);
});
test('unmarked tokenless responses remain invalid and ranked responses still require their exact token',async()=>{
 const missing=await read(cards({cfpCards:{version:2,preview:true}}),full({cfpDirectSort:undefined}));assert.equal(missing.renders,0);
 const ranked=cards({rankingToken:'token-1',cfpCards:{version:2,preview:true}});
 assert.equal((await read(ranked,full({rankingToken:'token-1',cfpDirectSort:undefined}))).renders,1);
 assert.equal((await read(ranked,full({rankingToken:'token-2',cfpDirectSort:undefined}))).renders,0);
});
