import * as pinImportOrder from "../../app/utils/pinImportOrder.js";
import {merchandisingRuleIds} from "../../app/utils/merchandisingSelection.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import { matchesRuleFilters } from "../../app/utils/ruleFilters.js";
import * as marketRuleCountries from "../../app/utils/marketRuleCountries.js";
import * as merchandisingMarketInvalidation from "../../app/utils/merchandisingMarketInvalidation.js";
import * as emptySearchPins from '../../app/utils/emptySearchPins.js';
import * as collectionSearchText from '../../app/utils/collectionSearchText.js';

const shop = "fixture.myshopify.com";
const request = new Request("https://fixture.test/app/search");

async function loadRoute(file, { authenticate, prisma }) {
  const { code } = await transform(await fs.readFile(file, "utf8"), {
    loader: "jsx", format: "cjs",
  });
  const context = {
    module: { exports: {} }, exports: {}, Response,
    console: { error() {} },
    require(name) {
      if(name==='../utils/collectionSearchText.js')return collectionSearchText;
      if(name==='../utils/emptySearchPins.js')return emptySearchPins;
      if(name==='../services/emptySearchPins.server.js')return {legacyEmptySearchProducts:async()=>[]};
      if (name === "../utils/pinImportOrder.js") return pinImportOrder;
      if (name === "../utils/merchandisingSelection.js") return {merchandisingRuleIds};
      if (name === '../services/merchandisingImport.server.js') return {};
      if (name === '../utils/marketRuleCountries.js') return marketRuleCountries;
      if (name === '../utils/merchandisingMarketInvalidation.js') return merchandisingMarketInvalidation;
      if (name === "../services/searchPicker.server.js") return {};
      if (name === "../services/shopCache.server") return {};
      if (name === "../shopify.server") return { authenticate: { admin: authenticate } };
      if (name === "../db.server") return { __esModule: true, default: prisma };
      if (name === "../utils/ruleFilters") return { matchesRuleFilters };
      if (name === "react" || name === "react-router" || name.startsWith("@shopify/") || name.startsWith("../components/")) return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, context);
  return context.module.exports;
}

const pinningFile = "app/routes/app.search.pinning._index.jsx";
const merchandisingFile = "app/routes/app.search.merchandising.jsx";

test('search merchandising collection conditions can select collections beyond the first page',async()=>{
 let reads=0;const target={id:'gid://shopify/Collection/454161989889',title:'A-Line Prom Dresses\u00a0'};
 const route=await loadRoute(merchandisingFile,{authenticate:async()=>({session:{shop},admin:{graphql:async(_query,options)=>{reads++;if(reads===2)assert.equal(options.variables.after,'later');return{json:async()=>({data:{collections:{nodes:reads===1?[{id:'gid://shopify/Collection/1',title:'First'}]:[target],pageInfo:{hasNextPage:reads===1,endCursor:'later'}}}})};}}}),prisma:{product:{groupBy:async()=>[]},$queryRaw:async()=>[],merchandisingRule:{findMany:async()=>[]}}});
 const result=await route.loader({request});assert.equal(reads,2);assert.equal(result.lookupWarning,null);assert.equal(result.shopifyCollections.find(c=>c.id===target.id).title,target.title);
});

for(const failure of ['none','later-page','repeated-cursor'])test('collection pin choices include later collections without sync: '+failure,async()=>{
 const initial=Array.from({length:250},(_,i)=>({id:'gid://shopify/Collection/'+(i+1),title:'Collection '+(i+1)}));
 const target={id:'gid://shopify/Collection/454161989889',title:'A-Line Prom Dresses\u00a0'};let reads=0,fallbacks=0;
 const route=await loadRoute('app/routes/app.collections.pinning._index.jsx',{
  authenticate:async()=>({session:{shop},admin:{graphql:async(_query,{variables})=>{reads++;
   if(reads===1){assert.equal(variables.after,null);return{json:async()=>({data:{collections:{nodes:initial,pageInfo:{hasNextPage:true,endCursor:'next'}}}})};}
   assert.equal(variables.after,'next');if(failure==='later-page')throw Error('Shopify unavailable');
   return{json:async()=>({data:{collections:{nodes:failure==='none'?[target,initial[0]]:[initial[0]],pageInfo:{hasNextPage:failure==='repeated-cursor',endCursor:'next'}}}})};
  }}}),
  prisma:{pinnedProductRule:{findMany:async()=>[]},collection:{findMany:async({where,select})=>{fallbacks++;assert.equal(where.shop,shop);assert.equal(select.id,true);assert.equal(select.title,true);return [initial[0],target];}}},
 });
 const result=await route.loader({request});assert.equal(reads,2);assert.equal(fallbacks,failure==='none'?0:1);assert.equal(result.collections.length,251);
 assert.equal(result.collections.find(c=>c.id===target.id).title,target.title);assert.equal(new Set(result.collections.map(c=>c.id)).size,result.collections.length);
});

test('collection pin display resolves legacy IDs from the scoped catalog beyond the dropdown first page', async () => {
  const rules=[{id:'legacy',collections:['Beyond first page'],products:[]},{id:'source',collections:['Renamed'],collectionSortKey:'[1,9]',products:[]}];
  const route=await loadRoute('app/routes/app.collections.pinning._index.jsx',{
    authenticate:async()=>({session:{shop},admin:{graphql:async()=>({json:async()=>({data:{collections:{nodes:[{id:'gid://shopify/Collection/1',title:'Dropdown collection'}],pageInfo:{hasNextPage:false,endCursor:null}}}})})}}),
    prisma:{pinnedProductRule:{findMany:async({where})=>{assert.equal(where.shop,shop);assert.equal(where.ruleType,'collection');return rules;}},
      collection:{findMany:async({where,select})=>{assert.equal(where.shop,shop);assert.deepEqual(Array.from(where.title.in),['Beyond first page','Renamed']);assert.equal(select.id,true);return [{id:'gid://shopify/Collection/999',title:'Beyond first page'}];}}},
  });
  const data=await route.loader({request});
  assert.equal(data.pinningRules[0].collectionSortKey,'[999]');
  assert.equal(data.pinningRules[1].collectionSortKey,'[1,9]');
  assert.equal(data.collections.length,1);
  assert.equal(rules[0].collectionSortKey,undefined);
});

test("Product Pinning loads shop rules without a Shopify API lookup", async () => {
  const rules = [{ id: "pin-1", searchQueries: ["dress"], products: [] }];
  const route = await loadRoute(pinningFile, {
    authenticate: async () => ({ session: { shop } }),
    prisma: { pinnedProductRule: { findMany: async ({ where }) => {
      assert.equal(where.shop, shop);
      assert.equal(where.ruleType, "search");
      return rules;
    } } },
  });
  assert.equal((await route.loader({ request })).pinningRules, rules);
});

async function merchandisingRoute(graphql) {
  const rules = [{ id: "rule-1", conditions: [], searchQueries: ["dress"] }];
  const route = await loadRoute(merchandisingFile, {
    authenticate: async () => ({ session: { shop }, admin: { graphql } }),
    prisma: {
      product: { groupBy: async ({ where }) => {
        assert.equal(where.shop, shop);
        return [];
      } },
      $queryRaw: async (_sql, scopedShop) => {
        assert.equal(scopedShop, shop);
        return [];
      },
      merchandisingRule: { findMany: async ({ where, include }) => {
        assert.equal(where.shop, shop);
        assert.equal(where.ruleType, "search");
        assert.equal(include.conditions, true);
        return rules;
      } },
    },
  });
  return { route, rules };
}

test("Merchandising keeps saved rules available when Shopify lookups fail", async () => {
  const { route, rules } = await merchandisingRoute(async () => { throw new Error("Throttled"); });
  const result = await route.loader({ request });
  assert.equal(result.merchandisingRules, rules);
  assert.match(result.lookupWarning, /could not be loaded/);
  assert.equal(result.shopifyCollections.length, 0);
  assert.equal(result.shopifyLocations.length, 0);
});

test("Merchandising reports partial GraphQL failures without losing available options", async () => {
  const { route } = await merchandisingRoute(async () => Response.json({
    errors: [{ message: "Access denied for locations" }],
    data: { collections: { nodes: [{ id: "collection-1", title: "Dresses" }] } },
  }));
  const result = await route.loader({ request });
  assert.ok(result.lookupWarning);
  assert.equal(result.shopifyCollections[0].title, "Dresses");
  assert.equal(result.shopifyLocations.length, 0);
});

test("Merchandising loads and sorts lookup options on success", async () => {
  const { route } = await merchandisingRoute(async () => Response.json({ data: {
    collections: { nodes: [{ id: "2", title: "Zebra" }, { id: "1", title: "Dresses" }] },
    locations: { nodes: [{ name: "Warehouse" }] },
    shop: { fulfillmentServices: [{ location: { name: "Warehouse" } }, { location: { name: "Store" } }] },
  } }));
  const result = await route.loader({ request });
  assert.equal(result.lookupWarning, null);
  assert.deepEqual(Array.from(result.shopifyCollections, c => c.title), ["Dresses", "Zebra"]);
  assert.deepEqual(Array.from(result.shopifyLocations), ["Store", "Warehouse"]);
});

test("Shopify API authentication responses are rethrown unchanged", async () => {
  const response = new Response(null, { status: 401, headers: { "X-Shopify-Retry-Invalid-Session-Request": "1" } });
  const { route } = await merchandisingRoute(async () => { throw response; });
  await assert.rejects(route.loader({ request }), error => error === response);
});

for (const file of [pinningFile, merchandisingFile]) {
  test(`${file} preserves authentication redirects before querying data`, async () => {
    const response = new Response(null, { status: 302, headers: { Location: "/auth/login" } });
    const route = await loadRoute(file, {
      authenticate: async () => { throw response; },
      prisma: {},
    });
    await assert.rejects(route.loader({ request }), error => error === response);
  });
}
