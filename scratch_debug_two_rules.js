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
    const combinedRule = {
      id: "combined",
      name: "Red Formal Dresses + Top Formal",
      conditions: [
        {
          action: "Dynamic",
          field: "Color (product option)",
          value: "Red",
          operator: "Add",
          operand: "99999",
        },
        {
          action: "Dynamic",
          field: "Tags",
          value: "TopFormal",
          operator: "Set",
          operand: "99",
        },
        {
          action: "Dynamic",
          field: "Tags",
          value: "BestFormal",
          operator: "Set",
          operand: "1000",
        }
      ]
    };

    const index = client.index("products");
    const res = await index.search("", {
      filter: [`collection_titles IN ['Red Formal Dresses']`],
      sort: ["bestSellingScore:desc", "trendingScore:desc", "createdAt:desc"],
      limit: 1000,
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

    // Test with fix: additive stacking
    const finalProducts = applyMerchandisingRules(
      mappedProducts,
      combinedRule,
      "best-selling",
      null,
      [],
      {}
    );

    console.log("\n--- TOP 15 PRODUCTS AFTER ADDITIVE STACKING FIX ---");
    finalProducts.slice(0, 15).forEach((p, idx) => {
      console.log(`${idx + 1}. [Score: ${p.merchandisingScore}] ID: ${p.id} | Title: ${p.title}`);
    });

  } catch (err) {
    console.error("Error:", err);
  }
}

runTest();
