import { Meilisearch } from "meilisearch";
import { applyMerchandisingRules } from "./app/services/merchandising.server.js";

const meiliHost = "http://52.52.183.81:7700";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

const client = new Meilisearch({
  host: meiliHost,
  apiKey: meiliKey,
});

async function runTest() {
  try {
    const activeRule = {
      id: "test",
      name: "Red Formal Dresses",
      conditions: [
        {
          action: "Dynamic",
          field: "Color (product option)",
          value: "Red",
          operator: "Add",
          operand: "99999",
        }
      ]
    };

    const index = client.index("products");
    const res = await index.search("", {
      filter: [`collection_titles IN ['Red Formal Dresses']`],
      limit: 500,
    });

    let mappedProducts = res.hits.map((h, idx) => ({
      ...h,
      _originalIndex: idx,
      id: `gid://shopify/Product/${h.id}`,
      variants: (h.variantPrices || []).map((v) => ({
        available: v.available,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        imageUrl: v.imageUrl || null,
      })),
    }));

    const finalProducts = applyMerchandisingRules(
      mappedProducts,
      activeRule,
      "manual", // DEFAULT COLLECTION SORT (MANUAL / ORIGINAL INDEX)
      null,
      [],
      {}
    );

    console.log("\n--- TOP 10 PRODUCTS WITH 'manual' SORT ---");
    finalProducts.slice(0, 10).forEach((p, idx) => {
      console.log(`Pos ${idx + 1}: [Score: ${p.merchandisingScore}] [OriginalIndex: ${p._originalIndex}] ID: ${p.id} | ${p.title}`);
    });

    const pos = finalProducts.findIndex(p => p.id.includes("15136882327923"));
    console.log(`\nCD0186 position with 'manual' sort: ${pos !== -1 ? pos + 1 : 'NOT FOUND'}`);
  } catch (err) {
    console.error("Error:", err);
  }
}

runTest();
