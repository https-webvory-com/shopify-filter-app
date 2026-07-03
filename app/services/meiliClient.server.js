import { Meilisearch } from "meilisearch";
import * as dotenv from "dotenv";

dotenv.config();

let meiliClient;

if (!global.meiliClient) {
  // Try VITE_ injected variables first, fallback to standard process.env, then default to localhost
  const host = import.meta.env?.VITE_MEILI_HOST || process.env["MEILI_HOST"] || process.env["VITE_MEILI_HOST"] || "http://127.0.0.1:7700";
  const apiKey = import.meta.env?.VITE_MEILI_MASTER_KEY || process.env["MEILI_MASTER_KEY"] || process.env["VITE_MEILI_MASTER_KEY"] || "masterKey";

  global.meiliClient = new Meilisearch({
    host,
    apiKey,
  });
}

meiliClient = global.meiliClient;

export default meiliClient;
