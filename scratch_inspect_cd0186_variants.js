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
    const cd0186 = res.hits.find(p => String(p.id).includes("15136882327923"));
    if (!cd0186) {
      console.log("CD0186 not found");
      return;
    }
    console.log("Product Title:", cd0186.title);
    console.log("Product options:", JSON.stringify(cd0186.options));
    console.log("VariantPrices:", JSON.stringify(cd0186.variantPrices, null, 2));
    console.log("Variants:", JSON.stringify(cd0186.variants, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

runTest();
