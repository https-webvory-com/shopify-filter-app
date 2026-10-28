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

// Ranking scans must not page through a changing hybrid blend. Keep the
// exhaustive lexical pass separate from the fixed semantic relevance window.
export async function keywordSearch(query, options) {
  const code=withSemanticSearch({q:query},false).matchingStrategy;
  return meiliClient.index("products").search(query,code?{...options,matchingStrategy:code}:options);
}

// A ranked page may use several count/page queries. Never mix semantic counts
// with keyword hits when an embedding request fails halfway through the plan.
export async function searchPageBatch(queries, mode) {
  const provider = semanticProvider();
  const semantic = mode !== false && queries.some(q => withSemanticSearch(q,true,provider).hybrid) && await isReady(provider);
  if (mode === true && !semantic) throw Error('Semantic search mode changed during page retrieval');
  try {
    return { ...(await meiliClient.multiSearch({ queries: queries.map(q => withSemanticSearch(q, semantic, provider)) })), semantic };
  } catch (error) {
    if (!semantic || mode === true) throw error;
    return { ...(await meiliClient.multiSearch({ queries })), semantic: false };
  }
}

export async function semanticMultiSearch(queries) {
  const provider = semanticProvider();
  const enabled = queries.some(query => query.q?.trim()) && await isReady(provider);
  return semanticFallback(prepared => meiliClient.multiSearch({ queries: prepared }), queries.map(query => withSemanticSearch(query, enabled, provider)));
}
