import { Meilisearch } from "meilisearch";

let meiliClient;

if (!global.meiliClient) {
  global.meiliClient = new Meilisearch({
    host: process.env.MEILI_HOST || "http://127.0.0.1:7700",
    apiKey: process.env.MEILI_MASTER_KEY || "masterKey",
  });
}

meiliClient = global.meiliClient;

export default meiliClient;
