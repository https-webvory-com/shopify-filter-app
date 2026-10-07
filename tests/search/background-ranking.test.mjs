import test from "node:test";
import assert from "node:assert/strict";
import { createBackgroundSnapshot } from "../../app/utils/backgroundSnapshot.js";
import { hydrateCollectionPage } from "../../app/utils/collectionPagination.js";

const settle = () => new Promise(resolve => setImmediate(resolve));

test("cold ranking returns immediately while one refresh is pending", async () => {
  let resolveRefresh;
  let calls = 0;
  const get = createBackgroundSnapshot({ read: async () => null, write: async () => {}, refresh: () => {
    calls++;
    return new Promise(resolve => { resolveRefresh = resolve; });
  }, onError() {} });
  assert.deepEqual(await get("shop:collection", {}), { value: null, status: "refreshing" });
  await get("shop:collection", {});
  assert.equal(calls, 1);
  resolveRefresh(["product"]);
  await settle();
  assert.deepEqual(await get("shop:collection", {}), { value: ["product"], status: "ready" });
});

test("refresh failures keep the saved ranking available and back off retries", async () => {
  let calls = 0;
  const get = createBackgroundSnapshot({ now: () => 1000, maxAge: 10,
    read: async () => ({ value: ["saved"], updatedAt: 1 }), write: async () => {},
    refresh: async () => { calls++; throw new Error("Throttled"); }, onError() {} });
  assert.deepEqual((await get("shop:collection", {})).value, ["saved"]);
  await settle();
  assert.deepEqual((await get("shop:collection", {})).value, ["saved"]);
  assert.equal(calls, 1);
});

test("hydrates only requested page details while preserving ranked order", async () => {
  const products = [{ id: "gid://shopify/Product/2", collectionBestSellingRank: 0 }, { id: "gid://shopify/Product/1", collectionBestSellingRank: 1 }];
  const result = await hydrateCollectionPage({ search: async (q, options) => {
    assert.equal(options.limit, 2);
    assert.deepEqual(options.filter, ["shop = 'fixture.myshopify.com'", "id IN [2,1]"]);
    return { hits: [{ id: 1, images: ["one.jpg"], variantPrices: [{ id: 11 }] }, { id: 2, images: ["two.jpg"], variantPrices: [{ id: 22 }] }] };
  } }, products, "fixture.myshopify.com", ["id", "images", "variantPrices"]);
  assert.deepEqual(result.map(p => p.id), products.map(p => p.id));
  assert.deepEqual(result[0].images, ["two.jpg"]);
  assert.equal(result[0].collectionBestSellingRank, 0);
  assert.equal(result[0].variantPrices[0].id, 22);
});
