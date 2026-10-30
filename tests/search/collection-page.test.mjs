import * as extraProductFilters from '../../app/utils/extraProductFilters.js';
import * as percentSaleFilter from '../../app/utils/percentSaleFilter.js';
import * as collectionCards from '../../app/utils/collectionCards.js';
import * as pinnedPrefix from '../../app/utils/collectionPinnedPrefix.js';
import * as productTitleFilter from '../../app/utils/productTitleFilter.js';
import * as collectionNavigation from '../../app/utils/collectionNavigation.js';
import * as marketAvailability from '../../app/utils/marketAvailability.js';
import * as searchColor from "../../app/utils/searchColor.js";
import * as facetNormalization from '../../app/utils/facetNormalization.js';
import {spellingCorrection} from "../../app/utils/spellingCorrection.js";
import {readyPreparation} from './helpers/prepared-ranking.mjs';
import * as availableVariants from "../../app/utils/availableVariants.js";
import test from "node:test";
import assert from "node:assert/strict";
import { fetchCollectionPage } from "../../app/utils/collectionPage.js";
import fs from "node:fs/promises";
import vm from "node:vm";
import { buildCollectionSequence, readRankedCollectionPage, hydrateCollectionPrices, hydrateCollectionInventory } from '../../app/utils/rankedCollectionPage.js';
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
    status: "ACTIVE", collections: ["gid://shopify/Collection/1"], boosted: i < 5555, tags: [], options: [{ name: "Color", values: [i < 5555 ? "Black" : "Blue"] }],
    images: ["blue.jpg", "green.jpg", "black.jpg"], variantPrices: [
      { id: `${i + 1}01`, option1: "Green", available: true, imageUrl: "green.jpg", price: 100 },
      { id: `${i + 1}02`, option1: "Blue", available: true, imageUrl: "blue.jpg", price: 100 },
      { id: `${i + 1}03`, option1: i < 5555 ? "Black" : "Blue", available: true, imageUrl: i < 5555 ? "black.jpg" : "blue.jpg", price: 100 },
    ], priceMin: 100, priceMax: 100,
  }));
  documents.push({ ...documents[0], id: "23111", status: "DRAFT" }, { ...documents[0], id: "23112", status: "ARCHIVED" });
  documents.push({ ...documents[0], id: "23113", collections: ["gid://shopify/Collection/2"], collection_titles: ["Black Tie Dresses"], tags: ["TopFormal"] });
  const pins = [1, 3, 5, 7, 9, 11].map(id => ({ id: `gid://shopify/Product/${id}` }));
  const savedPins = [...pins, { id: "gid://shopify/Product/23111" }, { id: "gid://shopify/Product/23112" }, { id: "gid://shopify/Product/23113" }];
  let countryMarket=null;
  const rule = { conditions: [{ action: "Boost", field: "Color (product option)", value: "Black", operator: "contains" }, { action: "Include", field: "Tags", value: "TopFormal", operator: "contains" }] };
  const matching = filter => {
    const text = JSON.stringify(filter);
    let eligible = text.includes("status = 'ACTIVE'") ? documents.filter(p => p.status === "ACTIVE") : documents;
    for(const condition of filter||[])if(typeof condition==='string'&&condition.startsWith('id IN ')){
      const ids=new Set(JSON.parse(condition.slice(6)));eligible=eligible.filter(product=>ids.has(product.id));
    }
    if (text.includes("collections = 'gid://shopify/Collection/1'")) {
      eligible = eligible.filter(p => p.collections.includes("gid://shopify/Collection/1") || (text.includes("OR tags IN") && p.tags.includes("TopFormal")) || (text.includes("collection_titles IN") && p.collection_titles?.includes("Black Tie Dresses")));
    }
    return text.includes("NOT (") ? eligible.filter(p => !p.boosted) : text.includes("option_Color") ? eligible.filter(p => p.boosted) : eligible;
  };
  let failSearch = false;
  const index = {
    async search(_q, options) { if (failSearch) throw new Error('Search unavailable'); return { hits: matching(options.filter).slice(options.offset, options.offset + options.limit) }; },
    async getDocument(id) { return documents.find(p => p.id === id); },
    async getDocuments() { throw Object.assign(new Error("id is not filterable on this server"), {code:'invalid_document_filter'}); },
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
  const sessions = new Map();
  let sourceOrder = { ids: Array.from({length:23110},(_,i)=>String(i+1)), status: "ready" };
  const mocks = {
    "react-router": { data: (value, options) => ({ ...value, _status: options?.status ?? 200 }) },
    "../db.server": { __esModule: true, default: { product: { findMany: async ({ where }) => {
      assert.equal(where.shop, "fixture.myshopify.com");
      assert.equal(where.status.equals, "active");
      assert.equal(where.collections, undefined, "Explicit pins do not require a collection link");
      return pins;
    } } } },
    "../services/merchandising.server": merchandising,
    "../services/filterSettings.server": {},
    "../services/meiliClient.server": { __esModule: true, default: meili },
    "../services/collectionBestSelling.server.js": { getCollectionBestSellingState: async () => sourceOrder },
    "../services/semanticSearch.server": { semanticMultiSearch: queries => meili.multiSearch({ queries }) },
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
    "../utils/rankedCollectionPage.js": { buildCollectionSequence, readRankedCollectionPage, hydrateCollectionPrices, hydrateCollectionInventory },
    "../services/collectionPreparation.server.js": readyPreparation({index,prisma:{product:{findMany:async()=>pins}},arrange:merchandising.applyMerchandisingRules}),
    "../services/collectionRankingSession.server.js": {
      collectionRankingFingerprint: () => 'fixture',
      getCollectionRankingSession: async (_shop, fingerprint, token) => token&&sessions.get(token)?.fingerprint===fingerprint ? sessions.get(token) : null,
      saveCollectionRankingSession: async (_shop, fingerprint, ids, updatedAt, metadata) => {
        const token = 'fixture-token-' + sessions.size;
        const session = { token, fingerprint, ids, updatedAt, metadata };
        sessions.set(token, session); return session;
      },
    },
  };
  const source = (await fs.readFile("app/routes/api.filter.jsx", "utf8")).replace('await import("../services/queryParser.server.js")', '({ parseQuery: () => null })');
  const context = { module: { exports: {} }, exports: {}, URL, Response, console: { log() {}, error() {} }, require: name => {if(name==='../services/searchIndex.server.js')return {getSearchIndexContext:async()=>({settings:null}),configuredSuggestions:async()=>null};if(name==='../utils/searchConfiguration.js')return {publicSearchProduct:p=>p};
    if(name==='../utils/productTitleFilter.js')return productTitleFilter;
    if(name==='../utils/extraProductFilters.js')return extraProductFilters;
    if(name==='../utils/percentSaleFilter.js')return percentSaleFilter;
    if(name==='../utils/collectionNavigation.js')return collectionNavigation;
    if(name==='../utils/marketAvailability.js')return marketAvailability;
    if(name==='../services/marketAvailability.server.js')return {getMarketAvailabilityState:async(_shop,country)=>countryMarket?{status:countryMarket.pending?'pending':'ready',version:country+countryMarket.version}:{status:'disabled',version:null},getMarketAvailableProductIds:async(_shop,country)=>countryMarket.ids[country]};
    if(name==='../utils/collectionFilterMembership.js')return {};
    if(name==='../services/collectionFilterMembership.server.js')return {collectionMembershipProof:async()=>null};
    if (name === "../utils/searchColor.js") return searchColor;
    if (name === "../utils/facetNormalization.js") return facetNormalization;
    if (name === "../services/searchRanking.server.js" || name === "../services/searchPicker.server.js") return {};
    if (name === "../utils/availableVariants.js") return availableVariants;
    if (name === "../utils/spellingCorrection.js") return {spellingCorrection};
if(name==='../utils/collectionPinnedPrefix.js')return pinnedPrefix;if(name==='../utils/collectionCards.js')return collectionCards;if(name==='../services/collectionCards.server.js')return {getPreparedCollectionCards:async()=>null,beginPreparedCollectionCards:async()=>null};
    if (!(name in mocks)) throw new Error(`Unexpected import ${name}`);
    return mocks[name];
  } };
  vm.runInNewContext((await transform(source, { loader: "jsx", format: "cjs" })).code, context);
  for (const page of [1, 223, 925]) {
    const response = await context.module.exports.loader({ request: new Request(`https://fixture.test/api/filter?shop=fixture.myshopify.com&collectionHandle=black-tie-dresses&page=${page}&limit=25`) });
    assert.equal(response.crash, undefined, response.error);
    assert.equal(response.totalCount, 23111);
    assert.equal(response.debug.collectionPaginationApplied, true);
    assert.equal(response.debug.collectionBestSellingApplied, true);
    assert.equal(response.debug.meiliError, null);
    assert.equal(response.products.length, page === 925 ? 11 : 25);
    assert.ok(response.products.every(p => !["gid://shopify/Product/23111", "gid://shopify/Product/23112"].includes(p.id)));
    if (page === 1) {
      assert.deepEqual(Array.from(response.products.slice(0, 6), p => p.id), pins.map(p => p.id));
      assert.ok(response.products.some(p => p.id === 'gid://shopify/Product/23113'), 'Include admits the active product outside Shopify membership');
      assert.equal(response.products[1].selectedVariantId, "301");
      assert.equal(response.products[1].merchandisingImage, "blue.jpg");
      assert.equal(response.products[1].pinnedProductImage, "blue.jpg");
      assert.equal(response.products[1].images[0], "blue.jpg");
      assert.equal(response.products[1].variants[0].option1, "Green");
      const ordinary=response.products.find(p=>p.id==='gid://shopify/Product/2');
      assert.equal(ordinary.selectedVariantId,"203");assert.equal(ordinary.variants[0].option1,"Black");
    }
    if (page === 223) assert.ok(response.products.some(p => p.id === "gid://shopify/Product/5556"));
    if (page === 925) assert.ok(response.products.some(p => p.id === "gid://shopify/Product/23110"));
  }
  const filtered = await context.module.exports.loader({ request: new Request("https://fixture.test/api/filter?shop=fixture.myshopify.com&collectionHandle=black-tie-dresses&option_Color=Blue&limit=25") });
  assert.equal(filtered.crash, undefined, filtered.error);
  assert.equal(filtered.products[0].variants[0].option1, "Blue");
  assert.equal(filtered.products[0].merchandisingImage, "blue.jpg");
  const load = query => context.module.exports.loader({ request: new Request('https://fixture.test/api/filter?shop=fixture.myshopify.com&collectionHandle=black-tie-dresses&limit=25&' + query) });
  sourceOrder = { ids: null, status: 'pending', refreshState: 'waiting' };
  const cold = await load('page=1');
  assert.equal(cold._status, 202); assert.equal(cold.products.length, 0);
  const retained = await load('page=2&rankingToken=fixture-token-0');
  assert.equal(retained._status, 200);
  assert.deepEqual(Array.from(retained.products, p => p.id.split('/').pop()), Array.from({ length: 25 }, (_, i) => String(i + 25)));
  sourceOrder = { ids: ['1'], status: 'stale', refreshState: 'waiting' };
  const stale = await load('page=1');
  assert.equal(stale._status, 200);
  assert.equal(stale.debug.collectionBestSellingStatus, 'stale');
  assert.equal(stale.debug.collectionBestSellingApplied, true);
  sourceOrder = { ids: ['1'], status: 'stale', refreshState: 'failed' };
  assert.equal((await load('page=1'))._status, 200);
  sourceOrder = { ids: null, status: 'failed', refreshState: 'failed' };
  assert.equal((await load('page=1'))._status, 503);
  sourceOrder = { ids: Array.from({ length: 23110 }, (_, i) => String(i + 1)), status: 'ready' };
  const normalPreparation = mocks['../services/collectionPreparation.server.js'].getPreparedCollectionRanking;
  for (const status of ['pending','failed']) {
    mocks['../services/collectionPreparation.server.js'].getPreparedCollectionRanking=async()=>({status});
    const waiting=await load('page=1');
    assert.equal(waiting._status,status==='failed'?503:202);assert.equal(waiting.products.length,0);
    assert.equal(waiting.debug.collectionRankingStatus,status);
    assert.equal(waiting.debug.collectionBestSellingStatus,status,'Older extension assets must also keep polling');
    const sessionPage=await load('page=2&rankingToken=fixture-token-0');
    assert.equal(sessionPage._status,200);assert.equal(sessionPage.products.length,25);
  }
  mocks['../services/collectionPreparation.server.js'].getPreparedCollectionRanking=normalPreparation;
  countryMarket={version:'v1',ids:{US:Array.from({length:70},(_,i)=>String(i+1)),IN:Array.from({length:70},(_,i)=>String(i+1)).filter(id=>!['1','3'].includes(id))}};
  const india=await load('country=IN&page=1');
  assert.equal(india._status,200);assert.equal(india.totalCount,68);assert.equal(india.products.length,25);
  assert.ok(india.products.every(p=>!['gid://shopify/Product/1','gid://shopify/Product/3'].includes(p.id)),'unavailable pins cannot bypass country eligibility with the global stock flag off');
  const indiaNext=await load('country=IN&page=2&rankingToken='+india.rankingToken);
  assert.equal(indiaNext.products.length,25);
  assert.equal(new Set([...india.products,...indiaNext.products].map(p=>p.id)).size,50);
  const usa=await load('country=US&page=1');assert.equal(usa.totalCount,70);assert.equal(usa.products[0].id,'gid://shopify/Product/1');
  assert.equal((await load('country=US&page=2&rankingToken='+india.rankingToken))._status,409);
  countryMarket.version='v2';countryMarket.ids.IN=countryMarket.ids.IN.filter(id=>id!=='5');
  assert.equal((await load('country=IN&page=2&rankingToken='+india.rankingToken))._status,409);
  const updated=await load('country=IN&page=1');assert.equal(updated.totalCount,67);assert.ok(updated.products.every(p=>p.id!=='gid://shopify/Product/5'));
  countryMarket.version='v3';countryMarket.ids.IN=[];const empty=await load('country=IN&page=1');assert.equal(empty.totalCount,0);assert.equal(empty.products.length,0);
  countryMarket.pending=true;const pending=await load('country=IN&page=1');assert.equal(pending._status,202);assert.equal(pending.products.length,0);
  countryMarket=null;
  failSearch = true;
  cache.clear();
  const unavailable = await load('page=1');
  assert.equal(unavailable._status, 503);
  assert.equal(unavailable.crash, true);
  assert.equal(unavailable.products, undefined);
});
