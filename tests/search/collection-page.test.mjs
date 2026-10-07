import test from "node:test";
import assert from "node:assert/strict";
import { fetchCollectionPage } from "../../app/utils/collectionPage.js";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";

function fixture(documents) {
  const calls = [];
  const matching = filter => documents.filter(product => !filter || (filter.includes("boosted") ? product.boosted : filter.includes("not-boosted") ? !product.boosted : true));
  return {
    calls,
    async search(q, options) {
      calls.push({ kind: "search", ...options });
      return { hits: matching(options.filter).slice(options.offset, options.offset + options.limit) };
    },
    async getDocuments(options) {
      throw new Error("Unknown field ids (older production server)");
    },
    async getDocument(id, options) {
      calls.push({ kind: "document", id, ...options });
      const document = documents.find(product => String(product.id) === id);
      if (!document) throw Object.assign(new Error("Missing document"), { code: "document_not_found" });
      return document;
    },
  };
}

const query = filter => ({ indexUid: "products", q: "", filter, sort: ["bestSellingScore:desc"] });
const run = (index, options) => fetchCollectionPage(index, { attributes: ["id", "images", "variantPrices"], ...options });

test("five pins do not skip normal products or inflate totals over successive pages", async () => {
  const documents = Array.from({ length: 65 }, (_, id) => ({ id: String(id + 1) }));
  const index = fixture(documents);
  const pins = ["2", "7", "31", "44", "61"];
  const output = [];
  for (const page of [1, 2, 3]) {
    const result = await run(index, { page, limit: 25, pinnedIds: pins, tiers: [{ query: query([]), total: 65 }] });
    assert.equal(result.total, 65);
    output.push(...result.hits.map(product => product.id));
  }
  assert.deepEqual(output, [...pins, ...documents.map(product => product.id).filter(id => !pins.includes(id))]);
  assert.equal(new Set(output).size, 65);
  assert.equal(index.calls.filter(call => call.kind === "document").length, 65);
});

test("a page crossing the boosted tier boundary starts fallback at its correct offset", async () => {
  const documents = Array.from({ length: 55 }, (_, id) => ({ id: String(id + 1), boosted: id < 28 }));
  const index = fixture(documents);
  const tiers = [{ query: query(["boosted"]), total: 28 }, { query: query(["not-boosted"]), total: 27 }];
  const output = [];
  for (const page of [1, 2, 3]) {
    const result = await run(index, { page, limit: 25, pinnedIds: [], tiers });
    assert.equal(result.total, 55);
    output.push(...result.hits.map(product => product.id));
  }
  assert.deepEqual(output, documents.map(product => product.id));
  const fallback = index.calls.filter(call => call.kind === "search" && call.filter.includes("not-boosted"));
  assert.deepEqual(fallback.map(call => [call.offset, call.limit]), [[0, 22], [22, 5]]);
});

test("pins spanning pages and pins outside the collection occupy slots exactly once", async () => {
  const documents = Array.from({ length: 16 }, (_, id) => ({ id: String(id + 1), boosted: id < 4 }));
  const index = fixture(documents);
  const pins = ["5", "6", "7", "8", "9", "10", "11"];
  const tiers = [{ query: query(["boosted"]), total: 4 }];
  const output = [];
  for (const page of [1, 2, 3]) {
    const result = await run(index, { page, limit: 5, pinnedIds: pins, tiers });
    assert.equal(result.total, 11);
    output.push(...result.hits.map(product => product.id));
  }
  assert.deepEqual(output, [...pins, "1", "2", "3", "4"]);
});

test("without pins the engine retrieves only the requested offset and page size", async () => {
  const index = fixture(Array.from({ length: 100 }, (_, id) => ({ id: String(id + 1) })));
  const result = await run(index, { page: 3, limit: 25, pinnedIds: [], tiers: [{ query: query([]), total: 100 }] });
  assert.equal(result.hits.length, 25);
  const search = index.calls.find(call => call.kind === "search");
  assert.equal(search.offset, 50);
  assert.equal(search.limit, 25);
});

test("pages beyond the end are empty and do not fetch full product details", async () => {
  const index = fixture([{ id: "1" }]);
  const result = await run(index, { page: 5, limit: 25, pinnedIds: ["1"], tiers: [{ query: query([]), total: 1 }] });
  assert.equal(result.total, 1);
  assert.deepEqual(result.hits, []);
  assert.ok(index.calls.every(call => !call.fields?.includes("images")));
});

test("all 23,110 products remain accessible after 5,555 boosted products and six pins", async () => {
  const documents = Array.from({ length: 23110 }, (_, i) => ({ id: String(i + 1), boosted: i < 5555 }));
  const index = fixture(documents);
  const tiers = [{ query: query(["boosted"]), total: 5555 }, { query: query(["not-boosted"]), total: 17555 }];
  const pins = ["1", "3", "5", "7", "9", "11"];
  const cache = new Map();
  const cacheIds = async (key, fetchIds) => {
    if (!cache.has(key)) cache.set(key, await fetchIds());
    return cache.get(key);
  };
  const boundary = await run(index, { page: 223, limit: 25, pinnedIds: pins, tiers, cacheIds });
  assert.equal(boundary.total, 23110);
  assert.deepEqual(boundary.hits.map(p => p.id), Array.from({ length: 25 }, (_, i) => String(5551 + i)));
  const last = await run(index, { page: 925, limit: 25, pinnedIds: pins, tiers, cacheIds });
  assert.equal(last.total, 23110);
  assert.deepEqual(last.hits.map(p => p.id), Array.from({ length: 10 }, (_, i) => String(23101 + i)));
  assert.equal(index.calls.filter(call => call.kind === "search").length, 2);
  assert.ok(index.calls.filter(call => call.kind === "search").every(call => call.attributesToRetrieve.length === 1 && call.attributesToRetrieve[0] === "id"));
});

test("a valid pin awaiting indexing retains its slot for DB hydration", async () => {
  const index = fixture([{ id: "1" }, { id: "2" }]);
  const result = await run(index, { page: 1, limit: 25, pinnedIds: ["3"], tiers: [{ query: query([]), total: 2 }] });
  assert.equal(result.total, 3);
  assert.deepEqual(result.hits.map(p => p.id), ["3", "1", "2"]);
});

test("a truncated ID snapshot fails explicitly instead of undercounting the collection", async () => {
  const index = fixture([{ id: "1" }]);
  await assert.rejects(run(index, { page: 1, limit: 25, pinnedIds: ["1"], tiers: [{ query: query([]), total: 23110 }] }), /Incomplete collection/);
});

test("the storefront loader returns the full count, pinned cards, and the final collection page", async () => {
  const documents = Array.from({ length: 23110 }, (_, i) => ({
    id: String(i + 1), title: `Dress ${i + 1}`, handle: `dress-${i + 1}`,
    status: "ACTIVE", boosted: i < 5555, tags: [], options: [{ name: "Color", values: [i < 5555 ? "Black" : "Blue"] }],
    images: ["blue.jpg", "green.jpg", "black.jpg"], variantPrices: [
      { id: `${i + 1}01`, option1: "Green", available: true, imageUrl: "green.jpg", price: 100 },
      { id: `${i + 1}02`, option1: "Blue", available: true, imageUrl: "blue.jpg", price: 100 },
      { id: `${i + 1}03`, option1: i < 5555 ? "Black" : "Blue", available: true, imageUrl: i < 5555 ? "black.jpg" : "blue.jpg", price: 100 },
    ], priceMin: 100, priceMax: 100,
  }));
  documents.push({ ...documents[0], id: "23111", status: "DRAFT" }, { ...documents[0], id: "23112", status: "ARCHIVED" });
  const pins = [1, 3, 5, 7, 9, 11].map(id => ({ id: `gid://shopify/Product/${id}` }));
  const savedPins = [...pins, { id: "gid://shopify/Product/23111" }, { id: "gid://shopify/Product/23112" }];
  const rule = { conditions: [{ action: "Boost", field: "Color (product option)", value: "Black", operator: "contains" }] };
  const matching = filter => {
    const text = JSON.stringify(filter);
    const eligible = text.includes("status = 'ACTIVE'") ? documents.filter(p => p.status === "ACTIVE") : documents;
    return text.includes("NOT (") ? eligible.filter(p => !p.boosted) : text.includes("option_Color") ? eligible.filter(p => p.boosted) : eligible;
  };
  const index = {
    async search(_q, options) { return { hits: matching(options.filter).slice(options.offset, options.offset + options.limit) }; },
    async getDocument(id) { return documents.find(p => p.id === id); },
    async getDocuments() { throw new Error("Unsupported ids request"); },
  };
  const meili = {
    index: () => index,
    async multiSearch({ queries }) {
      return { results: queries.map(query => ({ hits: [], totalHits: matching(query.filter).length, estimatedTotalHits: matching(query.filter).length, facetDistribution: {} })) };
    },
  };
  const serviceContext = { module: { exports: {} }, exports: {}, console, require: () => ({ __esModule: true, default: {} }) };
  vm.runInNewContext((await transform(await fs.readFile("app/services/merchandising.server.js", "utf8"), { format: "cjs" })).code, serviceContext);
  const merchandising = { ...serviceContext.module.exports,
    getActiveRuleForCollection: async () => rule,
    getActivePinningRuleForCollection: async () => ({ products: savedPins }),
  };
  const cache = new Map();
  const mocks = {
    "react-router": { data: value => value },
    "../db.server": { __esModule: true, default: { product: { findMany: async ({ where }) => {
      assert.equal(where.shop, "fixture.myshopify.com");
      assert.equal(where.status.equals, "active");
      return pins;
    } } } },
    "../services/merchandising.server": merchandising,
    "../services/filterSettings.server": {},
    "../services/meiliClient.server": { __esModule: true, default: meili },
    "../services/shopCache.server": { getCached: async (key, fetchValue) => {
      if (key.startsWith("globalSettings:")) return {};
      if (key.startsWith("mergedValues:")) return [];
      if (key.startsWith("filterGroup:")) return { resolvedCollectionId: "gid://shopify/Collection/1", resolvedCollectionTitle: "Black Tie Dresses", activeGroupFilters: [] };
      if (!cache.has(key)) cache.set(key, await fetchValue());
      return cache.get(key);
    } },
    "../shopify.server": {},
    "../services/rateLimiter.server": { rateLimit: async () => true },
    "../utils/collectionPage.js": { fetchCollectionPage },
  };
  const source = (await fs.readFile("app/routes/api.filter.jsx", "utf8")).replace('await import("../services/queryParser.server.js")', '({ parseQuery: () => null })');
  const context = { module: { exports: {} }, exports: {}, URL, Response, console: { log() {}, error() {} }, require: name => {
    if (!(name in mocks)) throw new Error(`Unexpected import ${name}`);
    return mocks[name];
  } };
  vm.runInNewContext((await transform(source, { loader: "jsx", format: "cjs" })).code, context);
  for (const page of [1, 223, 925]) {
    const response = await context.module.exports.loader({ request: new Request(`https://fixture.test/api/filter?shop=fixture.myshopify.com&collectionHandle=black-tie-dresses&page=${page}&limit=25`) });
    assert.equal(response.crash, undefined, response.error);
    assert.equal(response.totalCount, 23110);
    assert.equal(response.debug.collectionPaginationApplied, true);
    assert.equal(response.debug.meiliError, null);
    assert.equal(response.products.length, page === 925 ? 10 : 25);
    assert.ok(response.products.every(p => !["gid://shopify/Product/23111", "gid://shopify/Product/23112"].includes(p.id)));
    if (page === 1) {
      assert.deepEqual(Array.from(response.products.slice(0, 6), p => p.id), pins.map(p => p.id));
      assert.equal(response.products[1].selectedVariantId, "303");
      assert.equal(response.products[1].merchandisingImage, "black.jpg");
      assert.equal(response.products[1].variants[0].option1, "Black");
    }
    if (page === 223) assert.ok(response.products.some(p => p.id === "gid://shopify/Product/5556"));
    if (page === 925) assert.ok(response.products.some(p => p.id === "gid://shopify/Product/23110"));
  }
  const filtered = await context.module.exports.loader({ request: new Request("https://fixture.test/api/filter?shop=fixture.myshopify.com&collectionHandle=black-tie-dresses&option_Color=Blue&limit=25") });
  assert.equal(filtered.crash, undefined, filtered.error);
  assert.equal(filtered.products[0].variants[0].option1, "Blue");
  assert.equal(filtered.products[0].merchandisingImage, "blue.jpg");
});
