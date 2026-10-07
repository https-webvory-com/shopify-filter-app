import test from "node:test";
import assert from "node:assert/strict";
import { fetchCollectionPage } from "../../app/utils/collectionPage.js";

function fixture(documents) {
  const calls = [];
  const matching = filter => documents.filter(product => !filter || (filter.includes("boosted") ? product.boosted : filter.includes("not-boosted") ? !product.boosted : true));
  return {
    calls,
    async search(q, options) {
      calls.push({ kind: "search", ...options });
      return { hits: matching(options.filter).slice(options.offset, options.offset + options.limit).map(product => ({ id: product.id })) };
    },
    async getDocuments(options) {
      calls.push({ kind: "documents", ...options });
      const selected = new Set(options.ids);
      return { results: matching(options.filter).filter(product => selected.has(String(product.id))) };
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
  assert.ok(index.calls.filter(call => call.kind === "documents" && call.fields.includes("images")).every(call => call.limit <= 25));
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
