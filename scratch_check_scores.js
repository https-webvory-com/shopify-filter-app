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
    const res = await index.search("", {
      filter: [`collection_titles IN ['Red Formal Dresses']`],
      limit: 1000,
    });
    console.log("Hits in collection:", res.hits.length);

    let mappedProducts = res.hits.map((h, idx) => ({
      ...h,
      _originalIndex: idx,
      id: `gid://shopify/Product/${h.id}`,
      merchandisingScore: 99999, // All matching red dresses get +99999
    }));

    // Tie breaker using _originalIndex vs bestSellingScore:
    // If using _originalIndex:
    mappedProducts.sort((a, b) => a._originalIndex - b._originalIndex);

    console.log("\n--- TOP 10 PRODUCTS USING ORIGINAL INDEX TIE-BREAKER ---");
    mappedProducts.slice(0, 10).forEach((p, idx) => {
      console.log(`${idx + 1}. [OriginalIndex: ${p._originalIndex}] ID: ${p.id} - ${p.title}`);
    });

    const cd0186Idx = mappedProducts.findIndex(p => p.id.includes("15136882327923"));
    console.log(`\nCD0186 Position with _originalIndex tie-breaker: ${cd0186Idx + 1}`);
  } catch (err) {
    console.error("Error:", err);
  }
}

runTest();
