import { syncErrorMessage, productSyncJobWhere } from "../../app/utils/syncError.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import { isStorefrontProduct } from "../../app/utils/storefrontProduct.js";
import * as marketPricingIndex from "../../app/utils/marketPricingIndex.js";
import * as productMarketPrices from '../../app/utils/readProductMarketPrices.js';

test("only active products published to the Online Store are eligible", () => {
  assert.equal(isStorefrontProduct({ status: "ACTIVE", publishedAt: "2026-10-01T00:00:00Z" }), true);
  for (const product of [null, {}, { status: "ACTIVE", publishedAt: null }, { status: "ACTIVE" }, { status: "DRAFT", publishedAt: "2026-10-01T00:00:00Z" }, { status: "ARCHIVED", publishedAt: "2026-10-01T00:00:00Z" }]) {
    assert.equal(isStorefrontProduct(product), false);
  }
});

async function loadSync({ product, deleteError } = {}) {
  const calls = [];
  const source = (await fs.readFile("app/services/sync.server.js", "utf8")) + "\nexport { processSyncChunk };";
  const prisma = {
    filterSetting: { findMany: async () => [] },
    product: { deleteMany: async ({ where }) => calls.push(["deleteDB", where.shop, where.id]) },
    syncJob: {
      findUnique: async () => ({ status: "IN_PROGRESS" }),
      update: async ({ data }) => { calls.push(["job", data]); return { productsProcessed: 3 }; },
    },
  };
  const index = {
    deleteDocument: async id => { calls.push(["deleteIndex", id]); if (deleteError) throw deleteError; return {taskUid:1}; },
    addDocuments: async docs => { calls.push(["addIndex", docs]); return { taskUid: 1 }; },
  };
  const mocks = {
    './searchIndex.server.js':{scheduleSearchIndexProducts:async()=>{}},
    './collectionRuleFacts.server.js':{withCollectionRuleFacts:async docs=>docs},
    '../utils/embeddingHold.js':{withHeldEmbeddingsForIndex:async(_index,docs)=>docs},
    "../utils/syncError.js": { syncErrorMessage, productSyncJobWhere },
    "../db.server": { __esModule: true, default: prisma },
    "./meiliClient.server": { __esModule: true, default: { index: () => index, tasks: { waitForTask: async () => ({ status: "succeeded" }) } } },
    "./shopCache.server": { invalidateShop: async () => {} },
    "../utils/storefrontProduct.js": { isStorefrontProduct },
    "../utils/marketPricingIndex.js": marketPricingIndex,
    '../utils/readProductMarketPrices.js':productMarketPrices,
    "./marketPriceCoverage.server.js": { allMarketPriceCountries: async () => [], marketPriceCountriesForShop: async () => [] },
  };
  const context = { module: { exports: {} }, exports: {}, console: { log() {}, warn() {}, error() {} }, setTimeout: callback => callback(), require: name => mocks[name] };
  vm.runInNewContext((await transform(source, { format: "cjs" })).code, context);
  return { sync: context.module.exports, calls, admin: { graphql: async () => ({ json: async () => ({ data: { product } }) }) } };
}

for (const product of [{ status: "DRAFT", publishedAt: null }, { status: "ACTIVE", publishedAt: null }, { status: "ARCHIVED", publishedAt: null }]) {
  test(`product update removes ${product.status}/${product.publishedAt} from DB and index`, async () => {
    const { sync, calls, admin } = await loadSync({ product });
    await sync.syncSingleProduct("fixture.myshopify.com", admin, "gid://shopify/Product/1", { retrySearchErrors: true });
    assert.ok(calls.some(c => c[0] === "deleteIndex" && c[1] === "1"));
    assert.ok(calls.some(c => c[0] === "deleteDB" && c[1] === "fixture.myshopify.com"));
    assert.ok(!calls.some(c => c[0] === "addIndex"));
  });
}

test("a full sync visits draft products and removes stale unpublished entries", async () => {
  const { sync, calls } = await loadSync();
  let productRequests = 0;
  const admin = { graphql: async query => {
    if (query.includes("getPublishedCollections")) return { json: async () => ({ data: { collections: { nodes: [], pageInfo: { hasNextPage: false } } } }) };
    if (++productRequests > 1) throw new Error("End fixture after first batch");
    assert.ok(!query.includes('query: "status:active"'));
    return { json: async () => ({ data: { products: {
      nodes: [{ id: "gid://shopify/Product/1", status: "DRAFT", publishedAt: null }, { id: "gid://shopify/Product/2", status: "ACTIVE", publishedAt: null }, { id: "gid://shopify/Product/3", status: "ARCHIVED", publishedAt: null }],
      pageInfo: { hasNextPage: true, endCursor: "next" },
    } } }) };
  } };
  await assert.rejects(sync.processSyncChunk("job", "fixture.myshopify.com", admin), /End fixture/);
  assert.deepEqual(calls.filter(c => c[0] === "deleteIndex").map(c => c[1]), ["1", "2", "3"]);
  assert.equal(calls.find(c => c[0] === "addIndex")[1].length, 0);
  assert.equal(calls.find(c => c[0] === "job")[1].productsProcessed.increment, 3);
});
