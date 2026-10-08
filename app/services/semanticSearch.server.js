import meiliClient from "./meiliClient.server";
import { getCached } from "./shopCache.server";
import { withSemanticSearch, semanticFallback } from "../utils/semanticSearch.js";

async function isReady() {
  if (process.env.SEMANTIC_SEARCH_ENABLED === "false") return false;
  return getCached("semanticSearch:ready", async () => {
    try {
      const embedders = await meiliClient.index("products").getEmbedders();
      return !!embedders.default && embedders.default.source !== "userProvided";
    } catch {
      return false;
    }
  }, 30);
}

export async function semanticSearch(query, options) {
  const prepared = withSemanticSearch({ q: query, ...options }, !!query?.trim() && await isReady());
  return semanticFallback(async ([{ q, ...params }]) => meiliClient.index("products").search(q, params), [prepared]);
}

export async function semanticMultiSearch(queries) {
  const enabled = queries.some(query => query.q?.trim()) && await isReady();
  return semanticFallback(prepared => meiliClient.multiSearch({ queries: prepared }), queries.map(query => withSemanticSearch(query, enabled)));
}
