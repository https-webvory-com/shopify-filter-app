import { Meilisearch } from "meilisearch";

const client = new Meilisearch({
  host: "http://127.0.0.1:7700",
  apiKey: "masterKey",
});

async function main() {
  const index = client.index("products");
  const res = await index.updateFaceting({ maxValuesPerFacet: 10000 });
  console.log("Updated maxValuesPerFacet to 10000:", res);
}

main().catch(console.error);
