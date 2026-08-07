import { Meilisearch } from 'meilisearch';
const client = new Meilisearch({ host: 'http://52.52.183.81:7700', apiKey: 'c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=' });
async function run() {
  const r = await client.multiSearch({
    queries: [
      { indexUid: 'products', q: 'royal black', filter: ["option_Color IN ['royal', 'black', 'Royal Blue', 'Black', 'Royal/Black']"], limit: 5 }
    ]
  });
  console.log(r.results[0].hits.map(h => h.title));
}
run().catch(console.error);
