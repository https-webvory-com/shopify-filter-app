import { Meilisearch } from "meilisearch";

const vpsHost = "http://10.0.2.139:7700";
// Fallback if internal IP doesn't work locally:
const publicHost = "http://52.52.183.81:7700";

async function run() {
  let client;
  try {
    client = new Meilisearch({
      host: vpsHost,
      apiKey: "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=",
    });
    await client.getStats(); // simple ping
  } catch(e) {
    console.log("Internal IP failed, trying public IP...");
    client = new Meilisearch({
      host: publicHost,
      apiKey: "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=",
    });
  }

  const index = client.index("products");
  
  // Search for wedding dresses sorted by bestSellingScore
  const res = await index.search("", {
    filter: ["collection_titles IN ['Wedding Dresses']"],
    sort: ["bestSellingScore:desc"],
    limit: 10,
    attributesToRetrieve: ["id", "title", "bestSellingScore", "trendingScore", "priceMin"]
  });

  console.log("=== Top 10 Wedding Dresses in Meilisearch ===");
  res.hits.forEach((hit, i) => {
    console.log(`${i+1}. [${hit.bestSellingScore}] ${hit.title}`);
  });
  
  // Search for ALL products sorted by bestSellingScore
  const resAll = await index.search("", {
    sort: ["bestSellingScore:desc"],
    limit: 10,
    attributesToRetrieve: ["id", "title", "bestSellingScore", "trendingScore", "priceMin"]
  });

  console.log("\n=== Top 10 ALL Products in Meilisearch ===");
  resAll.hits.forEach((hit, i) => {
    console.log(`${i+1}. [${hit.bestSellingScore}] ${hit.title}`);
  });
}

run().catch(console.error);
