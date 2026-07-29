import { Meilisearch } from "meilisearch";
import { applyMerchandisingRules, getActiveRuleForCollection } from "../app/services/merchandising.server.js";

const meiliClient = new Meilisearch({
  host: "http://52.52.183.81:7700",
  apiKey: "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=",
});

async function main() {
  const shop = "thedressoutlet.myshopify.com";
  const resolvedCollectionId = "gid://shopify/Collection/162768257085";
  const collectionHandle = "black-tie-dresses";
  const page = 1;
  const limit = 25;
  const sortBy = "best-selling";

  // Simulate pinned IDs for black-tie-dresses
  const pinnedIds = [
    "gid://shopify/Product/15285137047923",
    "gid://shopify/Product/15284976681331",
    "gid://shopify/Product/15334785876339",
    "gid://shopify/Product/15292313239923",
    "gid://shopify/Product/15404493341043"
  ];

  const activePinningRule = {
    products: JSON.stringify(pinnedIds.map(id => ({ id })))
  };

  const hasPinning = pinnedIds.length > 0;
  const hasMerchandising = true; // active rule exists
  const needsBroadFetch = hasPinning || hasMerchandising;

  const pinnedBuffer = pinnedIds.length > 0 ? pinnedIds.length : 0;
  const broadFetchOffset = hasMerchandising ? 0 : Math.max(0, (page - 1) * limit - pinnedBuffer);
  const broadFetchLimit = hasMerchandising ? Math.max(1000, page * limit) : limit + pinnedBuffer + 10;

  const baseFilters = [`shop = '${shop}'`, `collections = '${resolvedCollectionId}'`];
  const allFiltersList = [...baseFilters];

  const mainQuery = {
    indexUid: "products",
    q: "",
    filter: allFiltersList,
    limit: needsBroadFetch ? broadFetchLimit : limit,
    offset: needsBroadFetch ? broadFetchOffset : (page - 1) * limit,
    attributesToRetrieve: [
      "id", "title", "handle", "vendor", "productType",
      "priceMin", "priceMax", "tags", "images", "variantPrices",
      "merchandisingImage", "options", "status", "available", "createdAt", "bestSellingRank",
      "bestSellingScore", "trendingScore"
    ],
    sort: ["createdAt:desc"]
  };

  const facetQuery = {
    indexUid: "products",
    q: "",
    filter: allFiltersList,
    facets: ["vendor", "productType"],
    hitsPerPage: 1,
    page: 1,
    attributesToRetrieve: [],
  };

  const multiSearchRes = await meiliClient.multiSearch({ queries: [mainQuery, facetQuery] });
  const meiliRes = multiSearchRes.results[0];
  const facetRes = multiSearchRes.results[1];

  console.log("1. Meilisearch hits count:", meiliRes.hits.length);

  let allMatchedProducts = (meiliRes.hits || []).map((h) => ({
    ...h,
    id: `gid://shopify/Product/${h.id}`,
    variants: (h.variantPrices || []).map((v) => ({
      available: v.available,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      option1: v.option1,
      option2: v.option2,
      option3: v.option3,
      imageUrl: v.imageUrl || null,
    })),
  }));

  console.log("2. allMatchedProducts count before pins:", allMatchedProducts.length);

  if (pinnedIds.length > 0) {
    pinnedIds.forEach((id) => {
      if (!allMatchedProducts.some((p) => p.id === id)) {
        allMatchedProducts.push({ id, variants: [] });
      }
    });
  }

  console.log("3. allMatchedProducts count after pins:", allMatchedProducts.length);

  const activeRule = {
    conditions: [
      { field: "Color (product option)", operator: "Equals", value: "Black", action: "Boost" }
    ]
  };

  const finalProducts = applyMerchandisingRules(
    allMatchedProducts,
    activeRule,
    sortBy,
    activePinningRule,
    []
  );

  console.log("4. finalProducts count:", finalProducts.length);

  const totalCount = facetRes?.totalHits ?? meiliRes.estimatedTotalHits ?? 0;
  let paginatedSlice = needsBroadFetch
    ? finalProducts.slice(
        (page - 1) * limit - broadFetchOffset,
        page * limit - broadFetchOffset
      )
    : finalProducts;

  console.log("5. paginatedSlice count:", paginatedSlice.length);
  console.log("6. totalCount:", totalCount);
}

main().catch(console.error);
