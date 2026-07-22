import { Meilisearch } from "meilisearch";

let meiliClient;

// Use environment variables for production, fallback to hardcoded for local dev
const host = process.env.MEILI_HOST || "http://52.52.183.81:7700";
const apiKey = process.env.MEILI_MASTER_KEY || "c9E90mOIsFK2jKgNy69i00PLiy9P/ot0ZE/ww6pfmH8=";

if (!global.meiliClient) {
  global.meiliClient = new Meilisearch({
    host,
    apiKey,
  });
}

meiliClient = global.meiliClient;

export default meiliClient;
