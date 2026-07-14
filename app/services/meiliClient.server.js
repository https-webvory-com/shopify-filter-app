import { Meilisearch } from "meilisearch";

let meiliClient;

const shopifyLocalHost =  "https://meilisearch.webvory.com";
const vpsHost = "http://127.0.0.1:7700"

if (!global.meiliClient) {
  global.meiliClient = new Meilisearch({
    host: vpsHost,
    apiKey: "819e418879c751fe28633f696152cd1edf7549a8bec743c8042cb2a8a99eed91",
  });
}

meiliClient = global.meiliClient;

export default meiliClient;
