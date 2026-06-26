import { Meilisearch } from "meilisearch";

let meiliClient;

if (!global.meiliClient) {
  global.meiliClient = new Meilisearch({
    host: "http://127.0.0.1:7700",
    apiKey: "masterKey",
  });
}

meiliClient = global.meiliClient;

export default meiliClient;
