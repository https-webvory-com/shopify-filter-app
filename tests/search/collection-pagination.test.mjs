import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import { collectCollectionCandidates, paginateRankedCollection } from "../../app/utils/collectionPagination.js";
import { fetchCollectionBestSellingIds, assignCollectionBestSellingRanks } from "../../app/utils/collectionBestSelling.js";

const { code } = await transform(await fs.readFile("app/services/merchandising.server.js", "utf8"), { format: "cjs" });
const context = { module: { exports: {} }, exports: {}, require: () => ({ default: {} }) };
vm.runInNewContext(code, context);
const { applyMerchandisingRules } = context.module.exports;
const makeProduct = (id, score, color = "Red") => ({
  id, title: id, bestSellingScore: score, _originalIndex: score,
  variants: [{ option1: color, available: true }],
});

test("fetches beyond the first batch while preserving collection filters and sort", async () => {
  const calls = [];
  const query = { indexUid: "products", q: "", filter: ["shop = 'fixture'", "collection_ids = 1"], sort: ["bestSellingScore:desc"], limit: 2, offset: 0 };
  const index = { search: async (q, options) => {
    calls.push({ q, options });
    return { hits: [{ id: 3 }, { id: 4 }, { id: 5 }].slice(options.offset - 2, options.offset) };
  } };
  const hits = await collectCollectionCandidates(index, query, { hits: [{ id: 1 }, { id: 2 }] }, 5);
  assert.deepEqual(hits.map(p => p.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(calls.map(c => c.options.offset), [2, 4]);
  assert.deepEqual(calls[0].options.filter, query.filter);
  assert.deepEqual(calls[0].options.sort, query.sort);
});

test("a boosted low seller moves across page boundaries while pins stay first", () => {
  const products = [makeProduct("seller", 100), makeProduct("second", 90), makeProduct("boosted", 1, "Black/Nude"), makeProduct("pin", 0)];
  const rule = { conditions: [{ action: "Boost", field: "Color (product option)", value: "Black" }] };
  const ranked = applyMerchandisingRules(products, rule, "best-selling", { products: [{ id: "pin" }] });
  const first = paginateRankedCollection(ranked, 1, 2);
  const second = paginateRankedCollection(ranked, 2, 2);
  assert.deepEqual(Array.from(first.products, p => p.id), ["pin", "boosted"]);
  assert.deepEqual(Array.from(second.products, p => p.id), ["seller", "second"]);
  assert.equal(first.totalCount, 4);
});

test("pins spanning pages, exclusion, burying and final count share one ranked sequence", () => {
  const products = [makeProduct("buried", 100), makeProduct("excluded", 90), makeProduct("ordinary", 10), ...["p1", "p2", "p3"].map(id => makeProduct(id, 0))];
  const rule = { conditions: [{ action: "Exclude", field: "Id", value: "excluded" }, { action: "Bury", field: "Id", value: "buried" }] };
  const ranked = applyMerchandisingRules(products, rule, "best-selling", { products: ["p1", "p2", "p3"].map(id => ({ id })) });
  const pages = [1, 2, 3].map(page => paginateRankedCollection(ranked, page, 2));
  assert.deepEqual(pages.flatMap(p => Array.from(p.products, item => item.id)), ["p1", "p2", "p3", "ordinary", "buried"]);
  assert.ok(pages.every(p => p.totalCount === 5));
});

test("fails rather than returning partially ranked results when retrieval stops early", async () => {
  await assert.rejects(collectCollectionCandidates({ search: async () => ({ hits: [] }) }, { q: "", limit: 2 }, { hits: [{ id: 1 }] }, 3), /all matching products/);
});

test("collection best-selling order wins over our lifetime sales scores within the same boost", () => {
  const products = [makeProduct("high-lifetime", 500, "Black"), makeProduct("collection-first", 1, "Black"), makeProduct("ordinary", 1000)];
  assignCollectionBestSellingRanks(products, ["ordinary", "collection-first", "high-lifetime"]);
  const ranked = applyMerchandisingRules(products, { conditions: [{ action: "Boost", field: "Color (product option)", value: "Black" }] }, "best-selling", null);
  assert.deepEqual(Array.from(ranked, product => product.id), ["collection-first", "high-lifetime", "ordinary"]);
});

test("pinned product keeps its position but uses the boosted black variant and image", () => {
  const product = makeProduct("pin", 0);
  product.variantPrices = [
    { id: "green", option1: "Green", available: true, imageUrl: "green.jpg" },
    { id: "blue", option1: "Blue", available: true, imageUrl: "blue.jpg" },
    { id: "black", option1: "Black", available: true, imageUrl: "black.jpg" },
  ];
  const ranked = applyMerchandisingRules([makeProduct("first", 10), product], { conditions: [{ action: "Boost", field: "Color (product option)", value: "Black" }] }, "best-selling", { products: [{ id: "first" }, { id: "pin", image: "blue.jpg" }] });
  assert.equal(ranked[1].id, "pin");
  assert.equal(ranked[1].merchandisingVariantId, "black");
  assert.equal(ranked[1].merchandisingImage, "black.jpg");
});

test("fetches Shopify collection BEST_SELLING order across cursors", async () => {
  const calls = [];
  const admin = { graphql: async (query, options) => {
    calls.push(options.variables);
    assert.match(query, /sortKey: BEST_SELLING/);
    return Response.json({ data: { collection: { products: {
      nodes: [{ id: options.variables.cursor ? "second" : "first" }],
      pageInfo: { hasNextPage: !options.variables.cursor, endCursor: "cursor" },
    } } } });
  } };
  assert.deepEqual(await fetchCollectionBestSellingIds(admin, "collection"), ["first", "second"]);
  assert.deepEqual(calls.map(call => call.cursor), [null, "cursor"]);
});

test("does not silently use lifetime scores when Shopify rejects collection ranking", async () => {
  const admin = { graphql: async () => Response.json({ errors: [{ message: "Access denied" }] }) };
  await assert.rejects(fetchCollectionBestSellingIds(admin, "collection"), /Access denied/);
});

test("storefront selects merchandising black instead of the first available green variant", async () => {
  const source = await fs.readFile("extensions/theme-extension/assets/collectionFilterPro.js", "utf8");
  const start = source.indexOf("      let variantImg = null;", source.indexOf("const productsHtml = products.map"));
  const end = source.indexOf("        let customImage = null;", start);
  assert.ok(start !== -1 && end > start);
  const select = new Function("product", "activeFilters", "mergedValues", source.slice(start, end) + ";return { matchedVariantId, variantImg, matchedVariant }; ");
  const result = select({
    merchandisingVariantId: "black", merchandisingImage: "black.jpg",
    variants: [{ id: "gid://shopify/ProductVariant/green", available: true }, { id: "gid://shopify/ProductVariant/black", available: true, imageUrl: "black.jpg" }],
  }, { options: {} }, []);
  assert.equal(result.matchedVariantId, "black");
  assert.equal(result.variantImg, "black.jpg");
  assert.equal(result.matchedVariant.id, "gid://shopify/ProductVariant/black");
});
