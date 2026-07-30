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
    const res = await index.search("CD0186", {
      limit: 10,
    });
    console.log("Hits found:", res.hits.length);
    res.hits.forEach((p, idx) => {
      console.log(`--- Hit ${idx + 1} ---`);
      console.log("ID:", p.id);
      console.log("Title:", p.title);
      console.log("Options:", JSON.stringify(p.options));
      console.log("Red variant:", JSON.stringify((p.variants || p.variantPrices || []).find(v => JSON.stringify(v).toLowerCase().includes("red"))));
    });
  } catch (err) {
    console.error("Error:", err);
  }
}

runTest();
