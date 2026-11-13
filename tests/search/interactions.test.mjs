import * as pinImportOrder from "../../app/utils/pinImportOrder.js";
import test from "node:test";
import * as csvImportReport from '../../app/utils/csvImportReport.js';
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import { availablePins } from "../../app/utils/availablePins.server.js";
import { matchesRuleFilters } from "../../app/utils/ruleFilters.js";
import { pinProductSearchFilter, pinProductTagSuggestions } from "../../app/utils/pinProductSearch.server.js";
import { catalogImageUrls } from "../../app/utils/pinProductImages.js";
import * as emptySearchPins from '../../app/utils/emptySearchPins.js';
import {
  searchPinScopeFromCsv,
  searchPinScopeToCsv,
} from "../../app/utils/searchPinCsv.js";

test("pin filters apply all/any, status, name, collection and search-query conditions", () => {
  const rule = {
    name: "Summer Dresses",
    status: true,
    collections: ["Summer"],
    searchQueries: ["dress", "gown"],
  };
  const filters = [
    { field: "Active", operator: "equals", value: true },
    { field: "Item name", operator: "contains", value: "WINTER" },
  ];
  assert.equal(matchesRuleFilters(rule, filters, "all"), false);
  assert.equal(matchesRuleFilters(rule, filters, "any"), true);
  assert.equal(matchesRuleFilters(rule, [], "any"), true);
  for (const [field, value] of [
    ["Collections", "summer"],
    ["Search Queries", "DRESS"],
  ]) {
    assert.equal(
      matchesRuleFilters(rule, [{ field, operator: "equals", value }]),
      true,
    );
    assert.equal(
      matchesRuleFilters(rule, [{ field, operator: "does not equal", value }]),
      false,
    );
  }
  assert.equal(
    matchesRuleFilters(rule, [
      { field: "Active", operator: "equals", value: false },
    ]),
    false,
  );
});

async function mockedModule(file, mocks) {
  const { code } = await transform(await fs.readFile(file, "utf8"), {
    loader: file.endsWith("jsx") ? "jsx" : "js",
    format: "cjs",
  });
  const context = {
    module: { exports: {} },
    exports: {},
    Response,
    URL,
    console,
    require(name) {
      if(name==='../utils/emptySearchPins.js')return emptySearchPins;
      if(name==='../services/emptySearchPins.server.js')return {legacyEmptySearchProducts:async()=>[],saveEmptySearchPin:async()=>null};
      if(name==='../services/searchCollectionPicker.server.js')return {getEmptySearchProductState:async(_shop,products)=>({products,stockOnly:false})};
      if (name === "../utils/pinImportOrder.js") return pinImportOrder;
      if (name === '../utils/csvImportReport.js') return csvImportReport;
      if (name === "../services/searchPicker.server.js") return mocks[name]||{};
      if (name === '../hooks/usePickerRequest') return {};
      if (name === "../utils/reorderSearchPins.js") return {};
      if (name in mocks) return mocks[name];
      if (name === '../services/shopCache.server.js' || name === '../services/shopCache.server') return { invalidateShop: async () => {} };
      if (name === "../utils/availablePins.server.js") return { availablePins };
      if (name === "../utils/pinProductImageFallbacks.server.js") return { pinProductImageFallbacks: async () => ({}) };
      if (name === "../utils/pinProductImages.js") return { catalogImageUrls };
      if (name === "../utils/pinProductSearch.server") return { pinProductSearchFilter, pinProductTagSuggestions };
      if (name.startsWith("../components/")) return {};
      if (
        [
          "react",
          "react-router",
          "@shopify/app-bridge-react",
          "@shopify/shopify-app-react-router/server",
        ].includes(name)
      )
        return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, context);
  return context.module.exports;
}

for (const section of ["collections", "search"]) {
  test(`${section} pin editor searches title or tags while retaining scope and pagination`, async () => {
    const shop = "fixture.myshopify.com";
    const calls = [];
    const prisma = {
      $queryRaw: async (sql, queryShop, text) => {
        assert.equal(queryShop, shop);
        assert.equal(text, "SUMMER");
        assert.ok(sql.join("?").includes("strpos(lower(tag), lower("));
        return [{ tag: "Summer Sale" }, { tag: "summer" }];
      },
      product: {
        count: async ({ where }) => { calls.push({ where }); return 12; },
        findMany: async (args) => { calls.push(args); return [{ id: "product-2", title: "Blue dress", images: [] }]; },
      },
    };
    const route = await mockedModule(`app/routes/app.${section}.pinning.$id.jsx`, {
      "../shopify.server": { authenticate: { admin: async () => ({ session: { shop } }) } },
      "../db.server": { __esModule: true, default: prisma },
      '../services/searchPicker.server.js':{searchPickerPage:async(tenant,target,options)=>{calls.push({tenant,target,options});return {products:[],totalCount:12};}},
    });
    for (const id of ["new", "rule-1"]) {
      for (const searchField of ["title", "tags"]) {
        calls.length = 0;
        const form = new FormData();
        Object.entries({ intent: "search", q: "  SUMMER  ", searchField,
          collections: '["Summer"]', applyToAll: "false", skip: "9", excludedIds: '["product-1"]',
        }).forEach(([key, value]) => form.set(key, value));
        const response = await route.action({ request: new Request("https://fixture.test", { method: "POST", body: form }), params: { id } });
        assert.equal((await response.json()).totalCount, 12);
        if(section==='search'){
          assert.equal(calls[0].tenant,shop);assert.equal(calls[0].target,'');assert.equal(calls[0].options.query.trim(),'SUMMER');assert.equal(calls[0].options.searchField,searchField);assert.equal(calls[0].options.skip,9);assert.deepEqual(Array.from(calls[0].options.excludedIds),['product-1']);continue;
        }
        const where = JSON.parse(JSON.stringify(calls[1].where));
        assert.equal(where.shop, shop);
        assert.equal(where.status, "active");
        assert.equal(where.variants.some.available, true);
        assert.deepEqual(where.id, { notIn: ["product-1"] });
        assert.equal(calls[1].skip, 9);
        assert.equal(calls[1].take, 9);
        assert.deepEqual(calls[0].where, calls[1].where);
        if (section === "collections") assert.deepEqual(where.collections.some.collection.title.in, ["Summer"]);
        if (searchField === "tags") {
          assert.deepEqual(where.tags, { hasSome: ["Summer Sale", "summer"] });
          assert.equal(where.title, undefined);
          assert.equal(where.OR, undefined);
        } else {
          assert.deepEqual(where.title, { contains: "SUMMER", mode: "insensitive" });
          assert.equal(where.OR, undefined);
          assert.equal(where.tags, undefined);
        }
      }
    }
  });
}

test("pin product search handles empty input, unmatched tags and unknown modes", async () => {
  const prisma = { $queryRaw: async () => [] };
  assert.deepEqual(await pinProductSearchFilter(prisma, "shop", " ", "tags"), {});
  assert.deepEqual(await pinProductSearchFilter(prisma, "shop", "absent", "tags"), { tags: { hasSome: [] } });
  assert.deepEqual(await pinProductSearchFilter(prisma, "shop", "dress", "invalid"), {
    OR: [
      { title: { contains: "dress", mode: "insensitive" } },
      { vendor: { contains: "dress", mode: "insensitive" } },
      { tags: { has: "dress" } },
    ],
  });
});

test("All searches survives editor load and save; editing does not enable a disabled pin", async () => {
  const writes = [];
  const route = await mockedModule("app/routes/app.search.pinning.$id.jsx", {
    "../shopify.server": {
      authenticate: {
        admin: async () => ({ session: { shop: "fixture.myshopify.com" } }),
      },
    },
    "../db.server": {
      __esModule: true,
      default: {
        pinnedProductRule: {
          create: async (args) => writes.push(args),
          update: async (args) => writes.push(args),
        },
      },
    },
    "react-router": {
      redirect: (location) =>
        new Response(null, { status: 302, headers: { Location: location } }),
    },
  });
  const loaded = await route.loader({
    request: new Request(
      "https://fixture.test/app/search/pinning/new?applyToAll=true",
    ),
    params: { id: "new" },
  });
  assert.equal(loaded.defaultParams.applyToAll, true);
  for (const id of ["new", "existing-pin"]) {
    const response = await route.action({
      params: { id },
      request: new Request("https://fixture.test/app/search/pinning/" + id, {
        method: "POST",
        body: new URLSearchParams({
          intent: "save",
          name: "All searches",
          applyToAll: "true",
          searchQueries: "[]",
          products: '[{"id":"product-1"}]',
          applyToSearchType: "page",
        }),
      }),
    });
    assert.equal(response.status, 302);
  }
  assert.equal(writes[0].data.applyToAll, true);
  assert.equal(writes[1].where.shop, "fixture.myshopify.com");
  assert.equal(Object.hasOwn(writes[1].data, "status"), false);
});

test("Search pin selection prefers query-specific pins and respects search type for all-search fallback", async () => {
  const all = {
    id: "all",
    applyToAll: true,
    searchQueries: [],
    applyToSearchType: "page",
  };
  const specific = {
    id: "dress",
    applyToAll: false,
    searchQueries: ["Dress"],
    applyToSearchType: "both",
  };
  const service = await mockedModule("app/services/merchandising.server.js", {
    "../db.server.js": {
      __esModule: true,
      default: {
        pinnedProductRule: {
          findMany: async ({ where }) => {
            assert.equal(where.shop, "fixture.myshopify.com");
            assert.equal(where.status, true);
            assert.equal(where.ruleType, "search");
            return [all, specific];
          },
        },
      },
    },
  });
  assert.equal(
    (
      await service.getActivePinningRuleForSearch(
        "fixture.myshopify.com",
        " dress ",
        "page",
      )
    ).id,
    "dress",
  );
  assert.equal(
    (
      await service.getActivePinningRuleForSearch(
        "fixture.myshopify.com",
        "coat",
        "page",
      )
    ).id,
    "all",
  );
  assert.equal(
    await service.getActivePinningRuleForSearch(
      "fixture.myshopify.com",
      "coat",
      "instant",
    ),
    null,
  );
  specific.applyToSearchType = "search";
  assert.equal(
    (
      await service.getActivePinningRuleForSearch(
        "fixture.myshopify.com",
        "dress",
        "page",
      )
    ).id,
    "dress",
  );
  assert.equal(
    await service.getActivePinningRuleForSearch(
      "fixture.myshopify.com",
      "dress",
      "instant",
    ),
    null,
  );
});

test("Search-pin CSV round trips all queries, all-search scope and search targets", () => {
  for (const applyToSearchType of ["page", "instant", "both", "none"]) {
    for (const applyToAll of [true, false]) {
      const original = {
        searchQueries: ["dress", "gown"],
        applyToSearchType,
        applyToAll,
      };
      const restored = searchPinScopeFromCsv(searchPinScopeToCsv(original));
      assert.deepEqual(restored.searchQueries, original.searchQueries);
      assert.equal(restored.applyToAll, applyToAll);
      assert.equal(restored.applyToSearchType, applyToSearchType);
    }
  }
  const legacy = searchPinScopeFromCsv({
    SearchQuery: "dress",
    AppliedToSearch: "TRUE",
    AppliedToInstantSearch: "FALSE",
  });
  assert.deepEqual(legacy.searchQueries, ["dress"]);
  assert.equal(legacy.applyToSearchType, "page");
  assert.equal(legacy.applyToAll, false);
});

test("Batch import persists all search queries and the all-search flag", async () => {
  const writes = [];
  const route = await mockedModule("app/routes/api.import-pins-batch.jsx", {
    "../shopify.server": {
      authenticate: {
        admin: async () => ({ session: { shop: "fixture.myshopify.com" } }),
      },
    },
    "../db.server": {
      __esModule: true,
      default: {
        product: {
          findMany: async () => [
            { id: "gid://shopify/Product/1", title: "Dress", images: [] },
          ],
        },
        collection: { findMany: async () => [] },
        pinnedProductRule: {
          upsert: async (args) => {
            writes.push(args);
            return args.create;
          },
        },
      },
    },
  });
  const response = await route.action({
    request: new Request("https://fixture.test/api/import-pins-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ruleType: "search",
        rows: [
          {
            products: [{ id: "1" }],
            searchQueries: ["dress", "gown"],
            applyToAll: false,
            applyToSearchType: "search",
          },
          {
            products: [{ id: "1" }],
            searchQueries: [],
            applyToAll: true,
            applyToSearchType: "both",
          },
        ],
      }),
    }),
  });
  assert.equal((await response.json()).imported, 2);
  assert.deepEqual(Array.from(writes[0].create.searchQueries), [
    "dress",
    "gown",
  ]);
  assert.equal(writes[0].create.applyToSearchType, "page");
  assert.equal(writes[1].create.applyToAll, true);
  assert.equal(writes[1].update.applyToAll, true);
});

test('product ID search accepts numeric IDs and GIDs without losing pinned exclusions', async () => {
  for (const text of ['12345', 'gid://shopify/Product/12345']) {
    const filter = await pinProductSearchFilter({}, 'shop', text, 'id');
    assert.deepEqual(filter, { AND: [{ id: { equals: 'gid://shopify/Product/12345' } }] });
    const where = { ...filter, id: { notIn: ['gid://shopify/Product/12345'] } };
    assert.equal(where.AND[0].id.equals, where.id.notIn[0]);
  }
  const invalid = await pinProductSearchFilter({}, 'shop', 'not an ID', 'id');
  assert.equal(invalid.AND[0].id.equals, '__invalid_product_id__');
});

for (const section of ['collections', 'search']) {
  test(section + ' tag suggestions remain tenant scoped and do not run a product search', async () => {
    const prisma = { $queryRaw: async (sql, shop, text) => {
      assert.equal(shop, 'fixture.myshopify.com'); assert.equal(text, 'Form');
      assert.match(sql.join('?'), /LIMIT 25/);
      return [{ tag: 'Formal' }];
    } };
    const route = await mockedModule('app/routes/app.' + section + '.pinning.$id.jsx', {
      '../shopify.server': { authenticate: { admin: async () => ({ session: { shop: 'fixture.myshopify.com' } }) } },
      '../db.server': { __esModule: true, default: prisma },
    });
    const body = new FormData(); body.set('intent', 'tagSuggestions'); body.set('q', 'Form');
    const result = await route.action({ request: new Request('https://fixture.test', { method: 'POST', body }), params: { id: 'new' } });
    assert.deepEqual(await result.json(), { query: 'Form', tags: ['Formal'] });
  });
}


test('collection pin import uses IDs for renamed collections and never broadens missing IDs to all collections', async () => {
  const writes = [];
  const route = await mockedModule('app/routes/api.import-pins-batch.jsx', {
    '../shopify.server': { authenticate: { admin: async () => ({ session: { shop: 'fixture.myshopify.com' } }) } },
    '../db.server': { __esModule: true, default: {
      product: { findMany: async () => [{ id: 'gid://shopify/Product/1', title: 'Dress', images: [] }] },
      collection: { findMany: async ({ where }) => {
        assert.equal(where.shop, 'fixture.myshopify.com');
        assert.ok(where.OR[1].id.in.includes('gid://shopify/Collection/10'));
        return [{ id: 'gid://shopify/Collection/10', title: 'Champagne Bridesmaids Dresses' }];
      } },
      pinnedProductRule: { upsert: async args => writes.push(args) },
    } },
  });
  const products = [{ Id: 1 }];
  const rows = [
    { externalId: 'renamed', collectionIds: [10], collectionTitles: ['Champagne Bridesmaid Dresses'], products },
    { externalId: 'legacy', collectionIds: [], collectionTitles: ['Champagne Bridesmaids Dresses'], products },
    { externalId: 'missing', collectionIds: [999], collectionTitles: ['Champagne Bridesmaids Dresses'], products },
  ];
  const response = await route.action({ request: new Request('https://fixture.test/api/import-pins-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows, ruleType: 'collection' }) }) });
  const result = await response.json();
  assert.equal(result.imported, 2); assert.equal(result.skipped, 1);
  assert.equal(result.errors[0].id, 'missing');
  assert.deepEqual(Array.from(writes[0].create.collections), ['Champagne Bridesmaids Dresses']);
  assert.equal(writes[0].create.applyToAll, false);
  assert.equal(writes[0].where.shop_name_ruleType.name, 'Champagne Bridesmaid Dresses');
});

test('pin import preserves Shopify authentication responses rather than reporting them as batch failures', async () => {
  const rejection = new Response(null, { status: 401, headers: { 'X-Shopify-Retry-Invalid-Session-Request': '1' } });
  const route = await mockedModule('app/routes/api.import-pins-batch.jsx', {
    '../shopify.server': { authenticate: { admin: async () => { throw rejection; } } },
    '../db.server': { __esModule: true, default: {} },
  });
  await assert.rejects(route.action({ request: new Request('https://fixture.test/api/import-pins-batch') }), value => value === rejection);
});
