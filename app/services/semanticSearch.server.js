import meiliClient from "./meiliClient.server";
import { getCached } from "./shopCache.server";
import { withSemanticSearch, semanticFallback, semanticProvider } from "../utils/semanticSearch.js";

const fallbackStopwords = new Set(['for', 'the', 'a', 'with']);
const withoutFallbackStopwords = query => String(query || '').split(/\s+/u)
  .filter(token => !fallbackStopwords.has(token.toLowerCase())).join(' ').trim();

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
  // Exact token coverage is the first pass. This avoids a semantic or
  // drop-token result turning a nonsensical one-word query into products.
  const index = meiliClient.index('products');
  if (query?.trim()) {
    const strict = await index.search(query, { ...options, matchingStrategy: 'all' });
    if (strict.hits?.length || !/\s/u.test(query.trim())) return strict;
    const simpler = withoutFallbackStopwords(query);
    if (simpler && simpler !== query.trim()) {
      const fallback = await index.search(simpler, { ...options, matchingStrategy: 'all' });
      if (fallback.hits?.length) return { ...fallback, relaxed: true, relaxedQuery: simpler };
    }
  }
  const provider = semanticProvider();
  const prepared = withSemanticSearch({ q: query, ...options }, !!query?.trim() && await isReady(provider), provider);
  return semanticFallback(async ([{ q, ...params }]) => index.search(q, { ...params, matchingStrategy: 'last' }), [prepared]);
}

// Ranking scans must not page through a changing hybrid blend. Keep the
// exhaustive lexical pass separate from the fixed semantic relevance window.
export async function keywordSearch(query, options) {
  return meiliClient.index("products").search(query,query?.trim()?{...options,matchingStrategy:'all'}:options);
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

export async function semanticMultiSearch(queries,{preferKeyword=false}={}) {
  // Search result counts and designer facets must describe the same complete
  // lexical set as the visible cards. Hybrid search can report only its
  // semantic window and omit matching vendors from a broad query.
  if(preferKeyword){
    const lexical=await meiliClient.multiSearch({queries:queries.map(query=>query.q?.trim()?{...query,matchingStrategy:'all'}:query)});
    if((lexical.results?.[0]?.totalHits??lexical.results?.[0]?.estimatedTotalHits??lexical.results?.[0]?.hits?.length??0)>0)return lexical;
  }
  const provider = semanticProvider();
  const enabled = queries.some(query => query.q?.trim()) && await isReady(provider);
  return semanticFallback(prepared => meiliClient.multiSearch({ queries: prepared }), queries.map(query => withSemanticSearch(query, enabled, provider)));
}
