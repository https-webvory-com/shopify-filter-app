import { Meilisearch } from "meilisearch";

const meiliHost = "http://52.52.183.81:7700";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

const client = new Meilisearch({
  host: meiliHost,
  apiKey: meiliKey,
});

async function run() {
  const index = client.index("products");

  const res1 = await index.search("Adora Design 3230", { limit: 1 });
  const res2 = await index.search("Adora 3229", { limit: 1 });
  const res3 = await index.search("Adora Design 1080", { limit: 1 });

  console.log("=== ADORA DESIGN 3230 ===");
  if (res1.hits.length > 0) {
    const p = res1.hits[0];
    console.log("Title:", p.title);
    console.log("Options:", JSON.stringify(p.options));
    console.log("Variant Prices (first 10):", p.variantPrices?.slice(0, 10));
    console.log("Images:", p.images?.slice(0, 5));
  }

  console.log("\n=== ADORA 3229 ===");
  if (res2.hits.length > 0) {
    const p = res2.hits[0];
    console.log("Title:", p.title);
    console.log("Options:", JSON.stringify(p.options));
    console.log("Variant Prices (first 10):", p.variantPrices?.slice(0, 10));
  }

  console.log("\n=== ADORA 1080 ===");
  if (res3.hits.length > 0) {
    const p = res3.hits[0];
    console.log("Title:", p.title);
    console.log("Options:", JSON.stringify(p.options));
    console.log("Variant Prices (first 10):", p.variantPrices?.slice(0, 10));
  }
}

run();
