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
    const handles = [
      "elegant-satin-off-shoulder-corset-prom-dress-formal-evening-gown",
      "ladivine-cd337c-long-plus-size-formal-corset-dress",
      "adora-design-1051-homecoming-short-sequin-applique-prom-dress",
      "cinderellla-divine-cd0186-prom-long-corset-slit-formal-dress",
      "cinderella-divine-cd337-a-line-prom-long-dress",
      "cinderella-divine-cd868-long-formal-fitted-prom-dress"
    ];
    for (const handle of handles) {
      const res = await index.search(handle, { limit: 1 });
      if (res.hits.length > 0) {
        const p = res.hits[0];
        console.log(`\n--- Handle: ${p.handle} (ID: ${p.id}) ---`);
        console.log("Title:", p.title);
        console.log("Options:", JSON.stringify(p.options));
        const redVar = (p.variantPrices || []).find(v =>
          (v.option1 || "").toLowerCase().includes("red") ||
          (v.option2 || "").toLowerCase().includes("red") ||
          (v.option3 || "").toLowerCase().includes("red")
        );
        console.log("Red Variant:", redVar ? JSON.stringify(redVar) : "NONE");
      }
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

runTest();
