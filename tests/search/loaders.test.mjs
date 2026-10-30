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

test('collection pin display resolves legacy IDs from the scoped catalog beyond the dropdown first page', async () => {
  const rules=[{id:'legacy',collections:['Beyond first page'],products:[]},{id:'source',collections:['Renamed'],collectionSortKey:'[1,9]',products:[]}];
  const route=await loadRoute('app/routes/app.collections.pinning._index.jsx',{
    authenticate:async()=>({session:{shop},admin:{graphql:async()=>({json:async()=>({data:{collections:{nodes:[{id:'gid://shopify/Collection/1',title:'Dropdown collection'}]}}})})}}),
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
