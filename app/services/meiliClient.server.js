import { Meilisearch } from "meilisearch";

let meiliClient;

const shopifyLocalHost =  "https://meilisearch.webvory.com";
const vpsHost = "http://127.0.0.1:7700"

if (!global.meiliClient) {
  global.meiliClient = new Meilisearch({
    host: shopifyLocalHost,
    apiKey: "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=",
  });
}

meiliClient = global.meiliClient;

export default meiliClient;
