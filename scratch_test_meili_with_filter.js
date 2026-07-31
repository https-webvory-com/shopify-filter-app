import { Meilisearch } from "meilisearch";

const meiliHost = "https://meilisearch.webvory.com";
const meiliKey = "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";
const meiliClient = new Meilisearch({ host: meiliHost, apiKey: meiliKey });

async function run() {
  const index = meiliClient.index("products");

  const filter = [
    "collection_titles IN ['Red Formal Dresses']",
    "(option_Color IN ['Red','RED','red','Red Multi','Deep Red','Dark Red','Bright Red','Ruby Red'] OR tags IN ['BestFormal'] OR tags IN ['TopFormal'])"
  ];

  const res = await index.search("", {
    filter: filter,
    limit: 25,
    offset: 0
  });

  console.log("=== MEILISEARCH SEARCH RESULT WITH FILTER ===");
  console.log("Estimated Total Hits:", res.estimatedTotalHits);
  console.log("Hits Returned:", res.hits.length);
  res.hits.forEach((h, idx) => {
    console.log(`${idx + 1}. [${h.id}] ${h.title}`);
    console.log(`   option_Color:`, JSON.stringify(h.option_Color));
    console.log(`   tags:`, JSON.stringify(h.tags));
  });
}

run();
