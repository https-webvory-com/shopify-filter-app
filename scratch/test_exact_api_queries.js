import { Meilisearch } from "meilisearch";

const meiliClient = new Meilisearch({
  host: "http://52.52.183.81:7700",
  apiKey: "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=",
});

async function testExactQueries() {
  const shop = "thedressoutlet.myshopify.com";
  const resolvedCollectionId = "gid://shopify/Collection/162768257085";

  const baseFilters = [`shop = '${shop}'`, `collections = '${resolvedCollectionId}'`];
  const allFiltersList = [...baseFilters];

  const targetFacets = [
    "vendor",
    "productType",
    "option_Color",
    "option_Size",
    "tags"
  ];

  const mainQuery = {
    indexUid: "products",
    q: "",
    filter: allFiltersList,
    limit: 1000,
    offset: 0,
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
    facets: targetFacets,
    hitsPerPage: 1,
    page: 1,
    attributesToRetrieve: [],
  };

  const queries = [mainQuery, facetQuery];

  try {
    const multiSearchRes = await meiliClient.multiSearch({ queries });
    console.log("MultiSearch Success!");
    console.log("Result 0 hits length:", multiSearchRes.results[0].hits?.length);
    console.log("Result 0 estimatedTotalHits:", multiSearchRes.results[0].estimatedTotalHits);
    console.log("Result 1 totalHits:", multiSearchRes.results[1].totalHits);
  } catch (e) {
    console.error("MultiSearch Error:", e);
  }
}

testExactQueries();
