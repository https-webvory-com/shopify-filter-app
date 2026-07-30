import { Meilisearch } from "meilisearch";

const meiliHost = "http://52.52.183.81:7700";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

const client = new Meilisearch({
  host: meiliHost,
  apiKey: meiliKey,
});

async function runTest() {
  try {
    const index = client.index("products");
    const res = await index.search("CD0186", { limit: 10 });
    const p = res.hits.find(h => String(h.id) === "15136882327923");
    if (p) {
      console.log("Product CD0186 fields in Meilisearch:");
      console.log("bestSellingScore:", p.bestSellingScore);
      console.log("bestSellingRank:", p.bestSellingRank);
      console.log("trendingScore:", p.trendingScore);
      console.log("createdAt:", p.createdAt);
      console.log("collections:", p.collections);
      console.log("collection_titles:", p.collection_titles);
    } else {
      console.log("CD0186 not found in search");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

runTest();
