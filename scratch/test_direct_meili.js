import { Meilisearch } from "meilisearch";

const client = new Meilisearch({
  host: "http://52.52.183.81:7700",
  apiKey: "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=",
});

async function main() {
  const index = client.index("products");
  
  // Test search for black-formal-dresses collection ID gid://shopify/Collection/640385122675
  const res = await index.search("", {
    filter: ["shop = 'thedressoutlet.myshopify.com'", "collections = 'gid://shopify/Collection/640385122675'"],
    limit: 25,
  });

  console.log("Hits count from Meilisearch:", res.hits.length);
  console.log("Estimated total hits:", res.estimatedTotalHits);
  console.log("First 3 titles:", res.hits.slice(0, 3).map(h => h.title));
}

main();
