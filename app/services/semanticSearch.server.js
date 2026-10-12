import meiliClient from "./meiliClient.server";
import { getCached } from "./shopCache.server";
import { withSemanticSearch, semanticFallback, semanticProvider } from "../utils/semanticSearch.js";

async function isReady(provider) {
  if (process.env.SEMANTIC_SEARCH_ENABLED === "false") return false;
  return getCached(`semanticSearch:ready:${provider}`, async () => {
    try {
      const embedders = await meiliClient.index("products").getEmbedders();
      const config = embedders[provider];
      return !!config && (provider === 'openai' ? config.source === 'openAi' ||
        (config.source === 'rest' && config.request?.provider === provider) :
        config.source === 'rest' && (config.request?.provider === provider || config.request?.model === 'models/gemini-embedding-2'));
    } catch {
      return false;
    }
  }, 30);
}

export async function semanticSearch(query, options) {
  const provider = semanticProvider();
  const prepared = withSemanticSearch({ q: query, ...options }, !!query?.trim() && await isReady(provider), provider);
  return semanticFallback(async ([{ q, ...params }]) => meiliClient.index("products").search(q, params), [prepared]);
}

export async function semanticMultiSearch(queries) {
  const provider = semanticProvider();
  const enabled = queries.some(query => query.q?.trim()) && await isReady(provider);
  return semanticFallback(prepared => meiliClient.multiSearch({ queries: prepared }), queries.map(query => withSemanticSearch(query, enabled, provider)));
}
