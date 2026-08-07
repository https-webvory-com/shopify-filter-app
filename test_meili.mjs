import { Meilisearch } from 'meilisearch';

const client = new Meilisearch({ host: 'http://52.52.183.81:7700', apiKey: 'c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=' });

async function run() {
  try {
    const res = await client.multiSearch({
      queries: [
        { indexUid: 'products', q: '', filter: ["option_Color IN ['red', 'Red']"], limit: 24, offset: 0 },
        { indexUid: 'products', q: 'red', filter: [], limit: 24, offset: 0 }
      ]
    });
    console.log("Tier 1 Hits:", res.results[0].estimatedTotalHits);
    console.log("Tier 2 Hits:", res.results[1].estimatedTotalHits);
  } catch (e) {
    console.error(e.message || String(e));
  }
}
run();
