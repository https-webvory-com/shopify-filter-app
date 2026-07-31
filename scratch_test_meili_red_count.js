import { Meilisearch } from "meilisearch";

const meiliHost = "http://52.52.183.81:7700";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

const client = new Meilisearch({
  host: meiliHost,
  apiKey: meiliKey,
});

async function run() {
  const index = client.index("products");

  // Search Red Formal Dresses collection with color Red filter
  const redRes = await index.search("", {
    filter: [
      "collection_titles IN ['Red Formal Dresses']",
      "option_Color IN ['Red', 'RED', 'red', 'Red Multi', 'Deep Red', 'Dark Red', 'Ruby Red']"
    ],
    limit: 100
  });

  console.log("Total Red dresses in collection:", redRes.estimatedTotalHits || redRes.totalHits);
  console.log("Sample Red dress titles:");
  redRes.hits.slice(0, 10).forEach((h, i) => console.log(`${i+1}. ${h.title}`));
}

run();
