import { Meilisearch } from "meilisearch";

let meiliClient;

const shopifyLocalHost =  "http://52.52.183.81:7700";
const vpsHost = "http://10.0.2.139:7700"

if (!global.meiliClient) {
  global.meiliClient = new Meilisearch({
    host: vpsHost,
    apiKey:  "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=",
  });
}

meiliClient = global.meiliClient;

export default meiliClient;