import { Meilisearch } from "meilisearch";

const meiliClient = new Meilisearch({
  host: "http://52.52.183.81:7700",
  apiKey: "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=",
});

async function main() {
  const shop = "thedressoutlet.myshopify.com";
  const resolvedCollectionId = "gid://shopify/Collection/640385122675";
  const activeCategories = ["vendor", "productType"];

  const baseFilters = [`shop = '${shop}'`, `collections = '${resolvedCollectionId}'`];
  const allFiltersList = [...baseFilters];

  const needsBroadFetch = true;
  const broadFetchLimit = 1000;
  const broadFetchOffset = 0;

  const mainQuery = {
    indexUid: "products",
    q: "",
    filter: allFiltersList,
    limit: needsBroadFetch ? broadFetchLimit : 25,
    offset: needsBroadFetch ? broadFetchOffset : 0,
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
    attributesToRetrieve: []
  };

  const queries = [mainQuery, facetQuery];

  try {
    const multiSearchRes = await meiliClient.multiSearch({ queries });
    console.log("multiSearch succeeded!");
    console.log("Result 0 hits count:", multiSearchRes.results[0].hits?.length);
    console.log("Result 1 totalHits:", multiSearchRes.results[1].totalHits);
  } catch (e) {
    console.error("multiSearch Error:", e);
  }
}

main();
