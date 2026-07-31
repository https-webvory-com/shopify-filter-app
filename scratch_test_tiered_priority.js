import { Meilisearch } from "meilisearch";

const meiliHost = "http://52.52.183.81:7700";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

const client = new Meilisearch({
  host: meiliHost,
  apiKey: meiliKey,
});

async function testPage(page) {
  const index = client.index("products");
  
  // Primary boost filter (Color = Red, score 99999):
  const filterString = "collection_titles IN ['Red Formal Dresses'] AND option_Color IN ['Red', 'RED', 'red', 'Red Multi', 'Deep Red', 'Dark Red', 'Ruby Red']";

  const res = await index.search("", {
    filter: filterString,
    limit: 25,
    offset: (page - 1) * 25
  });

  console.log(`\n=== PAGE ${page} ===`);
  console.log(`Returned ${res.hits.length} items (Total: ${res.estimatedTotalHits})`);
  
  // Check colors of returned hits
  const colors = res.hits.map(h => {
    const opts = (h.variantPrices || []).map(v => v.option1).filter(Boolean);
    return `${h.title.slice(0, 30)}... [${opts.slice(0,2).join(",")}]`;
  });

  console.log("Hits preview:", colors.slice(0, 5));
}

async function run() {
  await testPage(1);
  await testPage(6);
  await testPage(8);
  await testPage(10);
  await testPage(11);
}

run();
