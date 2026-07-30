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
    const res = await index.search("corset-satin-long-formal-evening-dress", { limit: 1 });
    if (res.hits.length > 0) {
      const p = res.hits[0];
      console.log("Product:", p.title, p.id);
      const redVars = (p.variantPrices || []).filter(v => (v.option1 || "").toLowerCase() === "red");
      console.log("Red Variants:", JSON.stringify(redVars, null, 2));
    }
  } catch (err) {
    console.error(err);
  }
}

runTest();
