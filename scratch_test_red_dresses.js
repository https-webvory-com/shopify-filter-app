import { Meilisearch } from "meilisearch";

const meiliHost = "http://52.52.183.81:7700";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

const client = new Meilisearch({
  host: meiliHost,
  apiKey: meiliKey,
});

async function run() {
  const index = client.index("products");

  // Query Page 1
  console.log("=== QUERY PAGE 1 (offset: 0, limit: 25) ===");
  const res1 = await index.search("", {
    filter: ["collection_titles IN ['Red Formal Dresses']"],
    offset: 0,
    limit: 25,
  });
  console.log("Page 1 hits length:", res1.hits.length);
  console.log("Page 1 totalHits / estimatedTotalHits:", res1.totalHits, res1.estimatedTotalHits);

  // Query Page 2
  console.log("\n=== QUERY PAGE 2 (offset: 25, limit: 25) ===");
  const res2 = await index.search("", {
    filter: ["collection_titles IN ['Red Formal Dresses']"],
    offset: 25,
    limit: 25,
  });
  console.log("Page 2 hits length:", res2.hits.length);
  console.log("Page 2 totalHits / estimatedTotalHits:", res2.totalHits, res2.estimatedTotalHits);
}

run();
