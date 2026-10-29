import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './helpers/search-ranking.mjs';
import {pinProductSearchFilter, pinProductTagSuggestions} from '../../app/utils/pinProductSearch.server.js';
import {catalogImageUrls} from '../../app/utils/pinProductImages.js';

const shop = 'fixture.myshopify.com';
const normalize = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const common = prisma => ({
  '../utils/merchandisingSelection.js': {},
  '../shopify.server': {authenticate: {admin: async () => ({session: {shop}})}},
  '../db.server': {default: prisma}, 'react-router': {}, react: {},
  '../utils/availablePins.server.js': {}, '../utils/pinProductImageFallbacks.server.js': {},
  '../utils/pinProductImages.js': {catalogImageUrls}, '../utils/pinProductSearch.server': {pinProductSearchFilter, pinProductTagSuggestions},
  '../components/merchandising/PinSearchField': {}, '../components/merchandising/PinProductImage': {}, '@shopify/app-bridge-react': {},
});

for (const failedLaterPage of [false,true]) test(`collection rule choices retain distinct IDs beyond the first page (fallback=${failedLaterPage})`,async()=>{
  const rules=[{id:'saved',collections:['New Arrivals'],collectionIds:['gid://shopify/Collection/2']}];let reads=0,fallbackReads=0;
  const prisma={product:{groupBy:async()=>[]},$queryRaw:async()=>[],merchandisingRule:{findMany:async()=>rules},collection:{findMany:async({where})=>{assert.equal(where.shop,shop);fallbackReads++;return[{id:'gid://shopify/Collection/2',title:'New Arrivals'}];}}};
  const mocks={...common(prisma),'../services/merchandisingImport.server.js':{},'../utils/merchandisingCondition.js':{}};
  for(const name of ['FilterModal','CreateRuleModal','CustomizeColumnsModal','ImportMerchandisingRulesModal','ExportMerchandisingRulesModal'])mocks['../components/merchandising/'+name]={};
  mocks['../shopify.server'].authenticate.admin=async()=>({session:{shop},admin:{graphql:async(query,options)=>{
    reads++;if(reads===1)return{json:async()=>({data:{collections:{nodes:[{id:'gid://shopify/Collection/1',title:'New Arrivals'}],pageInfo:{hasNextPage:true,endCursor:'next'}}}})};
    assert.equal(options.variables.after,'next');if(failedLaterPage)throw Error('Shopify unavailable');
    return{json:async()=>({data:{collections:{nodes:[{id:'gid://shopify/Collection/2',title:'New Arrivals'}],pageInfo:{hasNextPage:false}}}})};
  }}});
  const {loader}=await loadModule('app/routes/app.collections.merchandising.jsx',mocks);const data=normalize(await loader({request:new Request('https://fixture/app')}));
  assert.equal(reads,2);assert.equal(fallbackReads,Number(failedLaterPage));
  assert.deepEqual(data.shopifyCollections.map(c=>c.id),['gid://shopify/Collection/1','gid://shopify/Collection/2']);
  assert.deepEqual(data.merchandisingRules,rules);
});

for (const all of [false, true]) test(`collection picker overlaps count/cards and preserves scope, stock, exclusions and pagination (all=${all})`, async () => {
  let release;
  const gate = new Promise(resolve => release = resolve);
  const calls = [];
  const prisma = {product: {
    count: async args => {calls.push({kind:'count', ...args}); await gate; return 19;},
    findMany: async args => {calls.push({kind:'cards', ...args}); await gate; return [
      {id:'one', title:'Dress', handle:'dress', images:'["red.jpg"]'},
      {id:'two', title:'Empty', handle:'empty', images:null},
    ];},
  }};
  const {action} = await loadModule('app/routes/app.collections.pinning.$id.jsx', common(prisma));
  const pending = action({params:{id:'new'}, request:new Request('https://fixture/app', {method:'POST', body:new URLSearchParams({
    intent:'search', q:'red', searchField:'title', collections:'["Formal Dresses"]', applyToAll:String(all), skip:'9', excludedIds:'["pinned"]',
  })})});
  for(let i=0; i<30 && calls.length<2; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const started = calls.length;
  release();
  const result = await (await pending).json();
  assert.equal(started, 2, 'card retrieval starts before count completes');
  const [count, cards] = calls;
  assert.deepEqual(normalize(count.where), normalize(cards.where));
  assert.equal(cards.where.shop, shop);
  assert.equal(cards.where.status, 'active');
  assert.equal(cards.where.variants.some.available, true);
  assert.deepEqual(normalize(cards.where.id), {notIn:['pinned']});
  assert.deepEqual(normalize(cards.where.title), {contains:'red',mode:'insensitive'});
  assert.deepEqual(normalize(cards.where.collections), all ? undefined : {some:{collection:{title:{in:['Formal Dresses']}}}});
  assert.equal(cards.take, 9); assert.equal(cards.skip, 9);
  assert.deepEqual(Object.keys(cards.select), ['id','title','handle','images']);
  assert.equal(result.totalCount, 19);
  assert.deepEqual(result.products.map(p => p.image), ['red.jpg',null]);
});

for (const empty of [false, true]) test(`collection merchandising overlaps metadata reads and preserves dropdown/rule values (empty=${empty})`, async () => {
  const calls = [];
  let release;
  const gate = new Promise(resolve => release = resolve);
  const read = async (name, value) => {calls.push(name); await gate; return empty ? [] : value;};
  const prisma = {
    product:{groupBy: args => {
      assert.equal(args.where.shop, shop);
      return read(args.by[0], [{[args.by[0]]: args.by[0] === 'vendor' ? 'Maker' : 'Dress'}]);
    }},
    $queryRaw:(parts, ...values) => {
      assert.deepEqual(values, [shop]);
      const sql = parts.join('?');
      if(sql.includes('unnest(tags)')) return read('tags',[{tag:' silk '}]);
      if(sql.includes('FROM "Variant"')) return read('skus',[{sku:'SKU',productTitle:'Dress',option1:'Red',image:'variant.jpg'}]);
      if(sql.includes('jsonb_array_elements(options)')) {
        assert.match(sql,/SELECT DISTINCT/);
        return read('options',[{name:'Color',value:'Red'},{name:'Color',value:'Blue'},{name:'Color',value:'Red'}]);
      }
      assert.match(sql,/LIMIT 250/);
      return read('products',[{title:'Dress',image:'dress.jpg'}]);
    },
    merchandisingRule:{findMany:args => {
      assert.deepEqual(normalize(args.where),{shop,ruleType:'collection'});
      assert.equal(args.include.conditions,true);
      return read('rules',[{id:'rule',conditions:[{action:'Boost'}]}]);
    }},
  };
  const mocks = {...common(prisma),
    '../services/merchandisingImport.server.js': {}, '../utils/merchandisingCondition.js': {},
  };
  for(const name of ['FilterModal','CreateRuleModal','CustomizeColumnsModal','ImportMerchandisingRulesModal','ExportMerchandisingRulesModal']) mocks['../components/merchandising/'+name] = {};
  mocks['../shopify.server'].authenticate.admin = async () => ({session:{shop},admin:{graphql:async () => {
    calls.push('graphql'); await gate;
    return {json:async()=>({data:empty ? {} : {
      collections:{nodes:[{id:'2',title:'Z'},{id:'1',title:'A'}]}, locations:{nodes:[{name:'Warehouse'}]},
      shop:{fulfillmentServices:[{location:{name:'Warehouse'}},{location:{name:'Other'}}]},
    }})};
  }}});
  const {loader} = await loadModule('app/routes/app.collections.merchandising.jsx',mocks);
  const pending = loader({request:new Request('https://fixture/app')});
  for(let i=0;i<30 && calls.length<8;i++) await new Promise(resolve=>setTimeout(resolve,5));
  const started = calls.length; release();
  const result = normalize(await pending);
  assert.equal(started,8,'all independent reads start before awaiting any response');
  assert.deepEqual(result.shopifyCollections,empty ? [] : [{id:'1',title:'A'},{id:'2',title:'Z'}]);
  assert.deepEqual(result.shopifyOptions,empty ? {} : {Color:['Blue','Red']});
  assert.deepEqual(result.shopifyLocations,empty ? [] : ['Other','Warehouse']);
  assert.deepEqual(result.shopifyTags,empty ? [] : ['silk']);
  assert.deepEqual(result.shopifyProducts,empty ? [] : [{title:'Dress',image:'dress.jpg'}]);
  assert.deepEqual(result.shopifySkus,empty ? [] : [{title:'SKU|Dress Red',image:'variant.jpg'}]);
  assert.deepEqual(result.merchandisingRules,empty ? [] : [{id:'rule',conditions:[{action:'Boost'}]}]);
});
