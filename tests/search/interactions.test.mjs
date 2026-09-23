import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import { matchesRuleFilters } from "../../app/utils/ruleFilters.js";
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
      if (name in mocks) return mocks[name];
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
