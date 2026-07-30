import { Meilisearch } from "meilisearch";

const meiliHost = "http://52.52.183.81:7700";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

const client = new Meilisearch({
  host: meiliHost,
  apiKey: meiliKey,
});

async function run() {
  const index = client.index("products");

  const res1 = await index.search("Fitted Off Shoulder Sequin Prom Formal Dress", { limit: 1 });
  const res2 = await index.search("Metallic Long V-Neck Sleeveless Evening Dress", { limit: 1 });

  console.log("=== PRODUCT 1: Fitted Off Shoulder Sequin Prom Formal Dress ===");
  if (res1.hits.length > 0) {
    const p1 = res1.hits[0];
    console.log("ID:", p1.id);
    console.log("Options:", JSON.stringify(p1.options));
    console.log("Tags:", p1.tags);
    console.log("Variant Prices (first 10):", p1.variantPrices?.slice(0, 10));
  }

  console.log("\n=== PRODUCT 2: Metallic Long V-Neck Sleeveless Evening Dress ===");
  if (res2.hits.length > 0) {
    const p2 = res2.hits[0];
    console.log("ID:", p2.id);
    console.log("Options:", JSON.stringify(p2.options));
    console.log("Tags:", p2.tags);
    console.log("Variant Prices (first 10):", p2.variantPrices?.slice(0, 10));
  }
}

run();
