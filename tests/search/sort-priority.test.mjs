import * as extraProductFilters from '../../app/utils/extraProductFilters.js';
import * as percentSaleFilter from '../../app/utils/percentSaleFilter.js';
import * as collectionCards from '../../app/utils/collectionCards.js';
import * as pinnedPrefix from '../../app/utils/collectionPinnedPrefix.js';
import * as productTitleFilter from '../../app/utils/productTitleFilter.js';
import * as collectionNavigation from '../../app/utils/collectionNavigation.js';
import * as marketAvailability from '../../app/utils/marketAvailability.js';
import * as searchColor from "../../app/utils/searchColor.js";
import * as facetNormalization from '../../app/utils/facetNormalization.js';
import * as searchCachePolicy from '../../app/utils/searchCachePolicy.js';
import {spellingCorrection} from "../../app/utils/spellingCorrection.js";
import {readyPreparation} from './helpers/prepared-ranking.mjs';
import * as availableVariants from "../../app/utils/availableVariants.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { transform } from "esbuild";
import { fetchCollectionPage } from "../../app/utils/collectionPage.js";
import { buildCollectionSequence, readRankedCollectionPage, hydrateCollectionPrices, hydrateCollectionInventory } from '../../app/utils/rankedCollectionPage.js';

async function loadModule(file, mocks) {
  const source = (await fs.readFile(file, "utf8")).replace('await import("../services/queryParser.server.js")', '({ parseQuery: () => testParsedQuery })');
  const context = { testParsedQuery: mocks.testParsedQuery || null, module: { exports: {} }, exports: {}, URL, Response, console: { log() {}, error() {} }, require(name) {if(name==='../services/searchIndex.server.js')return {getSearchIndexContext:async()=>({settings:null}),configuredSuggestions:async()=>null};if(name==='../utils/searchConfiguration.js')return {publicSearchProduct:p=>p};
    if(name==='../utils/productTitleFilter.js')return productTitleFilter;
    if(name==='../utils/facetNormalization.js')return facetNormalization;
    if(name==='../utils/searchCachePolicy.js')return searchCachePolicy;
    if(name==='../utils/extraProductFilters.js')return extraProductFilters;
    if(name==='../utils/percentSaleFilter.js')return percentSaleFilter;
    if(name==='../utils/collectionNavigation.js')return collectionNavigation;
    if(name==='../utils/marketAvailability.js')return marketAvailability;
    if(name==='../services/marketAvailability.server.js')return {getMarketAvailabilityState:async()=>({status:'disabled',version:null}),getMarketAvailableProductIds:async()=>null};
    if(name==='../utils/collectionFilterMembership.js')return {};
    if(name==='../services/collectionFilterMembership.server.js')return {collectionMembershipProof:async()=>null};
    if (name === "../utils/searchColor.js") return searchColor;
    if (name === "../services/searchRanking.server.js" || name === "../services/searchPicker.server.js") return {};
    if (name === '../services/marketPriceCoverage.server.js') return {marketPriceIntentReady:async()=>false};
    if (name === "../utils/availableVariants.js") return availableVariants;
    if (name === "../utils/spellingCorrection.js") return {spellingCorrection};
    if (name in mocks) return mocks[name];
    if (name === '../services/collectionPreparation.server.js') return readyPreparation({
      index: mocks['../services/meiliClient.server'].default.index('products'),
      prisma: mocks['../db.server'].default, arrange: mocks['../services/merchandising.server'].applyMerchandisingRules,
    });
    if (name === "../services/collectionBestSelling.server.js") return {getCollectionBestSellingState: async()=>({ ids: Array.from({ length: 180 }, (_, i) => String(180 - i)), status: 'ready' })};
    if (name === "../utils/rankedCollectionPage.js") return { buildCollectionSequence, readRankedCollectionPage, hydrateCollectionPrices, hydrateCollectionInventory };
    if (name === "../services/collectionRankingSession.server.js") return {
      collectionRankingFingerprint: () => 'fixture', getCollectionRankingSession: async () => null,
      saveCollectionRankingSession: async (_shop, fingerprint, ids, updatedAt, metadata) => ({ token: 'fixture-token', fingerprint, ids, updatedAt, metadata }),
    };
    if (name === "../db.server.js") return { __esModule: true, default: {} };
    if (["react", "react-router", "@shopify/app-bridge-react", "@shopify/shopify-app-react-router/server"].includes(name)) return {};
if(name==='../utils/collectionPinnedPrefix.js')return pinnedPrefix;if(name==='../utils/collectionCards.js')return collectionCards;if(name==='../services/collectionCards.server.js')return {getPreparedCollectionCards:async()=>null,beginPreparedCollectionCards:async()=>null};
    throw Error("Unexpected import " + name);
  } };
  vm.runInNewContext((await transform(source, { loader: file.endsWith("jsx") ? "jsx" : "js", format: "cjs" })).code, context);
  return context.module.exports;
}

async function collectionRoute(settings) {
  const docs = Array.from({ length: 180 }, (_, i) => ({
    id: String(i + 1), title: "Dress " + (i + 1), handle: "dress-" + (i + 1), status: "ACTIVE",
    tags: i < 10 ? ["TopFormal"] : [], collections: ["gid://shopify/Collection/1"],
    bestSellingScore: i + 1, trendingScore: 0, createdAt: i + 1,
    images: ["black.jpg"], options: [{ name: "Color", values: ["Black"] }], available:true, priceMin: i + 1, priceMax: i + 1,
    variantPrices: [{ id: String(i + 1) + "01", option1: "Black", available: true, price: i + 1, imageUrl: "black.jpg" }],
  }));
  const byId = new Map(docs.map(p => [p.id, p]));
  const matching = filter => {
    const text = JSON.stringify(filter);
    return docs.filter(p => !text.includes('available NOT EXISTS') &&
      (!text.includes('NOT (id IN') || p.id!=='2') &&
      (!text.includes("TopFormal") || (text.includes("NOT (") ? !p.tags.length : p.tags.length)));
  };
  const select = options => {
    const products = matching(options.filter).map(p => ({ ...p }));
    const sort = options.sort?.[0];
    products.sort((a,b) => sort === "priceMin:asc" ? a.priceMin-b.priceMin :
      sort === "title:asc" ? a.title.localeCompare(b.title) :
      sort === "title:desc" ? b.title.localeCompare(a.title) :
      sort === "createdAt:asc" ? a.createdAt-b.createdAt : b.bestSellingScore-a.bestSellingScore);
    return { hits: products.slice(options.offset || 0, (options.offset || 0) + (options.limit ?? 25)), totalHits: products.length, estimatedTotalHits: products.length, facetDistribution: {} };
  };
  const index = { search: async (_q, options) => select(options), getDocument: async id => ({ ...byId.get(id) }) };
  const meili = { index: () => index, multiSearch: async ({ queries }) => { settings.captureQueries?.push(...queries); return { results: queries.map(select) }; } };
  const service = await loadModule("app/services/merchandising.server.js", {});
  const pins = { products: ["1", "175"].map(id => ({ id: "gid://shopify/Product/" + id })) };
  const rule = settings.rule || { conditions: [{ action: "Boost", field: "Tags", value: "TopFormal", operator: "contains" }] };
  const cache = new Map();
  const route = await loadModule("app/routes/api.filter.jsx", {
    testParsedQuery: settings.testParsedQuery,
    "react-router": { data: value => value },
    "../db.server": { __esModule: true, default: { product: { findMany: async () => pins.products } } },
    "../services/merchandising.server": { ...service, getActiveRuleForCollection: async () => rule, getActivePinningRuleForCollection: async () => pins },
    "../services/filterSettings.server": {},
    "../services/meiliClient.server": { __esModule: true, default: meili },
    "../services/semanticSearch.server": { semanticMultiSearch: queries => meili.multiSearch({ queries }) },
    "../services/shopCache.server": { getCached: async (key, fetchValue) => {
      if (key.startsWith("globalSettings:")) return settings;
      if (key.startsWith("mergedValues:")) return [];
      if (key.startsWith("filterGroup:")) return { resolvedCollectionId: "gid://shopify/Collection/1", resolvedCollectionTitle: "Dresses", activeGroupFilters: [] };
      if (!cache.has(key)) cache.set(key, await fetchValue());
      return cache.get(key);
    } },
    "../shopify.server": {}, "../services/rateLimiter.server": { rateLimit: async () => true },
    "../utils/collectionPage.js": { fetchCollectionPage },
  });
  return page => route.loader({ request: new Request("https://fixture.test/api/filter?shop="+(settings.shop||'fixture.myshopify.com')+"&collectionId=1&limit=25&" + page) });
}

for (const overPins of [false,true]) for (const overMerch of [false,true]) {
  test("collection priority pin=" + overPins + " merchandising=" + overMerch + " preserves bestselling pins across pagination", async () => {
    const load = await collectionRoute({ prioritizeSortOverPinning: overPins, prioritizeSortOverMerchandising: overMerch });
    const output = [];
    for(let page=1;page<=8;page++) {
      const result = await load("page=" + page + "&sortBy=best-selling");
      assert.equal(result.totalCount, 180); assert.equal(result.debug.meiliError, null);
      assert.ok(result.products.every(p => p.title && p.handle && p.images.length && p.variants.length));
      output.push(...Array.from(result.products,p=>p.id.split("/").pop()));
    }
    const base = Array.from({length:180},(_,i)=>String(180-i));
    const tiers = [...base.filter(id=>Number(id)<=10), ...base.filter(id=>Number(id)>10)];
    const expected = ["1", "175", ...tiers.filter(id=>!["1","175"].includes(id))];
    assert.deepEqual(output,expected); assert.equal(new Set(output).size,180);
    const empty = await load("page=9&sortBy=best-selling"); assert.equal(empty.products.length,0);
  });
}

test("priority ON respects price sorting and filtered collection membership", async()=>{
  const load=await collectionRoute({prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true});
  const price=await load("page=1&sortBy=price-ascending");
  assert.deepEqual(Array.from(price.products,p=>Number(p.id.split("/").pop())),Array.from({length:25},(_,i)=>i+1));
  const inLoad=await collectionRoute({prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true,shop:'thedressoutlet.myshopify.com'});
  const partial=await inLoad("page=1&sortBy=price-ascending&country=IN");
  assert.equal(partial.priceSortSource,'partial-market');
  assert.equal(partial.products.length,25,'missing market prices remain visible');
  const us=await inLoad("page=1&sortBy=price-ascending&country=US");
  assert.equal(us.priceSortSource,'saved-usd-base');
  assert.deepEqual(Array.from(us.products,p=>Number(p.id.split('/').pop())),Array.from({length:25},(_,i)=>i+1));
  const fast=await inLoad("page=1&sortBy=price-ascending&country=US&responseProfile=fast-cards-v1");
  assert.equal(fast.priceSortSource,'saved-usd-base');
  assert.equal(fast.cfpCards.version,2);
  assert.equal(fast.cfpCards.filtered,false);
  assert.deepEqual(Array.from(fast.products,p=>Number(p.id.split('/').pop())),Array.from({length:25},(_,i)=>i+1));
  const filtered=await load("page=1&tag[]=TopFormal&sortBy=best-selling");
  assert.equal(filtered.totalCount,10);
  assert.deepEqual(Array.from(filtered.products,p=>Number(p.id.split("/").pop())),[1,10,9,8,7,6,5,4,3,2]);
});

test('title sort pages directly when both priorities override ordering-only rules',async()=>{
  const captureQueries=[];
  const load=await collectionRoute({prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true,captureQueries});
  const first=await load('page=1&sortBy=title-ascending');
  const second=await load('page=2&sortBy=title-ascending');
  const names=[...first.products,...second.products].map(product=>product.title);
  assert.equal(first.debug.collectionRankingStatus,'inactive');
  assert.equal(first.totalCount,180);
  assert.equal(new Set(names).size,50);
  assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b)));
  assert.ok(captureQueries.some(query=>query.sort?.[0]==='title:asc'&&query.limit===25));
});

test('exact stock and ID exclusions retain pin protection in direct title sort',async()=>{
  const captureQueries=[];
  const conditions=[
    {action:'Boost',field:'Tags',value:'TopFormal'},
    {action:'Exclude',field:'Available',value:'-999',minValue:'-999',maxValue:'0'},
    {action:'Exclude',field:'Id',value:'2'},
  ];
  const rule={conditions,ruleGroups:[{conditions}],collectionTagMatching:'exact'};
  const load=await collectionRoute({prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true,rule,captureQueries});
  const first=await load('page=1&sortBy=title-ascending');
  const second=await load('page=2&sortBy=title-ascending');
  const ids=[...first.products,...second.products].map(p=>p.id.split('/').pop());
  assert.equal(first.debug.collectionRankingStatus,'inactive');
  assert.equal(first.totalCount,179);
  assert.equal(new Set(ids).size,50);
  assert.ok(!ids.includes('2'));
  assert.ok(captureQueries.some(query=>JSON.stringify(query.filter).includes('available = false')&&
    JSON.stringify(query.filter).includes('NOT (id IN')&&JSON.stringify(query.filter).includes('OR id IN')));
});

for (const overPins of [false, true]) for (const overMerch of [false, true]) {
  test(`price sort independently respects pin=${overPins} and merchandising=${overMerch} priorities`, async () => {
    const load = await collectionRoute({ prioritizeSortOverPinning: overPins, prioritizeSortOverMerchandising: overMerch });
    const result = await load('page=1&sortBy=price-descending');
    const ids = Array.from(result.products, p => Number(p.id.split('/').pop()));
    const all = Array.from({ length: 180 }, (_, i) => 180 - i);
    const pinned = overPins ? [] : [1, 175];
    const sorted = overMerch ? all : [...all.filter(id => id <= 10), ...all.filter(id => id > 10)];
    const ordinary = sorted.filter(id => !pinned.includes(id));
    const expected = [...pinned, ...ordinary];
    assert.deepEqual(ids, expected.slice(0, 25));
  });
}

test("bestselling score precedes existing position and ties preserve existing order", async()=>{
  const {sortProductsByDefault}=await loadModule("app/services/merchandising.server.js",{});
  const products=[{id:"low",bestSellingScore:1,_originalIndex:0},{id:"high",bestSellingScore:10,_originalIndex:1},{id:"tie",bestSellingScore:10,_originalIndex:2}];
  assert.deepEqual(Array.from(sortProductsByDefault(products,"best-selling"),p=>p.id),["high","tie","low"]);
});

test("priority settings save true and false independently without resetting other settings",async()=>{
  let saved;
  const route=await loadModule("app/routes/app.filters.settings.jsx",{
    "../shopify.server":{authenticate:{admin:async()=>({session:{shop:"fixture.myshopify.com"}})}},
    "../services/filterSettings.server":{updateFilterGlobalSettings:async(shop,payload)=>{saved=payload;}},
  });
  for(const key of ["prioritizeSortOverPinning","prioritizeSortOverMerchandising"])for(const value of ["true","false"]){
    const form=new FormData();form.set(key,value);
    const result=await route.action({request:new Request("https://fixture.test/app/filters/settings",{method:"POST",body:form})});
    assert.equal(result.success,true);assert.deepEqual(JSON.parse(JSON.stringify(saved)),{[key]:value==="true"});
  }
});


test("bestselling alias and manual default retain pins with both priorities ON", async()=>{
  const load=await collectionRoute({prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true});
  for(const sort of ["bestselling","manual"]){
    const first=await load("page=1&sortBy="+sort);
    assert.deepEqual(Array.from(first.products.slice(0,2),p=>p.id.split("/").pop()),["1","175"]);
    const next=await load("page=2&sortBy="+sort);
    assert.ok(next.products.every(p=>!["1","175"].includes(p.id.split("/").pop())));
  }
});

test("price and newest override pins and boosts across all pages with priorities ON", async()=>{
  const load=await collectionRoute({prioritizeSortOverPinning:true,prioritizeSortOverMerchandising:true});
  for(const sort of ["price-ascending","created-descending"]){
    const ids=[];
    for(let page=1;page<=8;page++){
      const result=await load("page="+page+"&sortBy="+sort);
      assert.equal(result.totalCount,180);assert.equal(result.debug.meiliError,null);
      ids.push(...Array.from(result.products,p=>Number(p.id.split("/").pop())));
    }
    assert.deepEqual(ids,Array.from({length:180},(_,i)=>sort==="price-ascending"?i+1:180-i));
  }
});


test("parsed color remains mandatory in all collection search fallback and facet queries", async () => {
  const captureQueries=[];
  const colorFilter='(option_Color IN ["Black"])';
  const run=await collectionRoute({captureQueries,testParsedQuery:{
    hasFilters:true,remainingQuery:'dress',filters:{colors:['Black'],vendors:[],types:[]},
    queryColorWords:['black'],colorIntent:{requested:['black'],values:['Black']},colorFilter
  }});
  const response=await run('page=1&q=black%20dress');
  assert.equal(response.error,undefined);
  assert.ok(captureQueries.length>=4);
  assert.ok(captureQueries.every(query=>query.filter.includes(colorFilter)));
  assert.ok(response.products.every(product=>product.searchColor==='Black' && product.searchColorImage==='black.jpg'));
});
