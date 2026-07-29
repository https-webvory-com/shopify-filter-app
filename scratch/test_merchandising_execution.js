import { Meilisearch } from "meilisearch";
import { applyMerchandisingRules } from "../app/services/merchandising.server.js";

const meiliClient = new Meilisearch({
  host: "http://52.52.183.81:7700",
  apiKey: "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=",
});

async function run() {
  const shop = "thedressoutlet.myshopify.com";
  const resolvedCollectionId = "gid://shopify/Collection/640385122675";
  
  const baseFilters = [`shop = '${shop}'`, `collections = '${resolvedCollectionId}'`];

  const mainQuery = {
    indexUid: "products",
    q: "",
    filter: baseFilters,
    limit: 1000,
    offset: 0,
    attributesToRetrieve: [
      "id", "title", "handle", "vendor", "productType",
      "priceMin", "priceMax", "tags", "images", "variantPrices",
      "merchandisingImage", "options", "status", "available", "createdAt",
      "bestSellingScore", "trendingScore"
    ],
    sort: ["createdAt:desc"]
  };

  const res = await meiliClient.multiSearch({ queries: [mainQuery] });
  const meiliRes = res.results[0];

  console.log("Raw Meilisearch hits count:", meiliRes.hits.length);

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

  // Let's test running applyMerchandisingRules with null rule and fake pinning
  const pinnedIds = [
    "gid://shopify/Product/15285137047923",
    "gid://shopify/Product/15292313239923",
    "gid://shopify/Product/15290791428467",
    "gid://shopify/Product/15285132034419",
    "gid://shopify/Product/15299007906163"
  ];

  const fakePinningRule = {
    products: JSON.stringify(pinnedIds.map(id => ({ id })))
  };

  const finalProducts = applyMerchandisingRules(
    allMatchedProducts,
    null, // rule
    "best-selling",
    fakePinningRule,
    []
  );

  console.log("finalProducts count:", finalProducts.length);
  console.log("Slice(0, 25) count:", finalProducts.slice(0, 25).length);
}

run();
