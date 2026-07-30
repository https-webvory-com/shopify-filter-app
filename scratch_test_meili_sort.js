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
    
    // Test 1: WITH bestSellingScore sort (Current code)
    const resWithSort = await index.search("", {
      filter: [`collection_titles IN ['Red Formal Dresses']`],
      sort: ["bestSellingScore:desc", "trendingScore:desc", "createdAt:desc"],
      limit: 200,
    });
    const pos1 = resWithSort.hits.findIndex(p => String(p.id).includes("15136882327923") || p.title.includes("CD0186"));
    console.log("With bestSellingScore sort -> CD0186 position:", pos1 !== -1 ? pos1 + 1 : "NOT IN TOP 200");

    // Test 2: WITHOUT bestSellingScore sort (Default index order)
    const resNoSort = await index.search("", {
      filter: [`collection_titles IN ['Red Formal Dresses']`],
      limit: 200,
    });
    const pos2 = resNoSort.hits.findIndex(p => String(p.id).includes("15136882327923") || p.title.includes("CD0186"));
    console.log("Without sort (Default index order) -> CD0186 position:", pos2 !== -1 ? pos2 + 1 : "NOT IN TOP 200");

    if (pos2 !== -1) {
      console.log("Details at pos2:", resNoSort.hits[pos2].title, resNoSort.hits[pos2].id);
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

runTest();
