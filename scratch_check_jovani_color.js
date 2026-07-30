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
    const res = await index.search("6606722793533", { limit: 10 });
    const p = res.hits.find(h => String(h.id) === "6606722793533");
    if (p) {
      console.log("=== Jovani 03038 ===");
      console.log("Title:", p.title);
      console.log("Options:", JSON.stringify(p.options));
      console.log("Variants:", JSON.stringify(p.variantPrices));
    } else {
      console.log("Not found in Meilisearch search by 6606722793533");
      const res2 = await index.search("Jovani 03038", { limit: 1 });
      if (res2.hits.length > 0) {
        const p2 = res2.hits[0];
        console.log("Found by title:", p2.id, p2.title);
        console.log("Options:", JSON.stringify(p2.options));
        console.log("Variants:", JSON.stringify(p2.variantPrices));
      }
    }
  } catch (err) {
    console.error(err);
  }
}

runTest();
