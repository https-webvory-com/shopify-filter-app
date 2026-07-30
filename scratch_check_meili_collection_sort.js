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
    const settings = await index.getSettings();
    console.log("Sortable Attributes in Meilisearch:", settings.sortableAttributes);
  } catch (err) {
    console.error(err);
  }
}

runTest();
