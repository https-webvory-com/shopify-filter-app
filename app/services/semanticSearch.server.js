import meiliClient from "./meiliClient.server";
import { getCached } from "./shopCache.server";
import { withSemanticSearch, semanticFallback, semanticProvider } from "../utils/semanticSearch.js";
import {prepareConfiguredSearchQueries} from './searchIndex.server.js';

const fallbackStopwords = new Set(['for', 'the', 'a', 'with']);
const withoutFallbackStopwords = query => String(query || '').split(/\s+/u)
  .filter(token => !fallbackStopwords.has(token.toLowerCase())).join(' ').trim();

// Engine multiword synonyms require a phrase match. Explicit query branches
// also find terms in separate attributes (e.g. White color + Dress title).
async function runQuery({indexUid='products',q,_cfpSynonymQueries,...options}) {
  if(!_cfpSynonymQueries?.length)return meiliClient.index(indexUid).search(q,options);
  // This engine supports federated offset pagination, but no exhaustive page
  // counts. Let native ranking select its existing exhaustive compatible path.
  if(options.page!=null||options.hitsPerPage!=null)throw Error('Synonym union requires compatible search ranking');
  const {offset=0,limit=20,facets,...params}=options;
  const federation={offset,limit,...(facets?.length?{facetsByIndex:{[indexUid]:facets},mergeFacets:{maxValuesPerFacet:100000}}:{})};
  const result=await meiliClient.multiSearch({queries:[...new Set([q,..._cfpSynonymQueries])].map(text=>({indexUid,q:text,...params,matchingStrategy:'all'})),federation});
  return {...result,query:q,hits:result.hits.map(({_federation,...hit})=>hit)};
}
async function runBatch(queries){
  if(!queries.some(q=>q._cfpSynonymQueries?.length))return meiliClient.multiSearch({queries});
  return {results:await Promise.all(queries.map(runQuery))};
}

async function isReady(provider,indexUid='products') {
  if (process.env.SEMANTIC_SEARCH_ENABLED === "false") return false;
  return getCached(`semanticSearch:ready:${provider}:${indexUid}`, async () => {
    try {
      const embedders = await meiliClient.index(indexUid).getEmbedders();
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
  const [{indexUid,_cfpSemanticDisabled,_cfpSmartSku,q,...scoped}]=await prepareConfiguredSearchQueries([{q:query,...options}]);
  const index = {search:(q,params)=>runQuery({indexUid,q,...params})};
  if (q?.trim()) {
    const strict = await index.search(q, { ...scoped, matchingStrategy: 'all' });
    if (strict.hits?.length || !/\s/u.test(q.trim())) return strict;
    const simpler = withoutFallbackStopwords(q);
    if (simpler && simpler !== q.trim()) {
      const fallback = await index.search(simpler, { ...scoped, matchingStrategy: 'all' });
      if (fallback.hits?.length) return { ...fallback, relaxed: true, relaxedQuery: simpler };
    }
  }
  const provider = semanticProvider();
  const prepared = withSemanticSearch({q,...scoped}, !_cfpSemanticDisabled&&!!q?.trim() && await isReady(provider,indexUid), provider);
  return semanticFallback(async ([{ q: fallbackQuery, ...params }]) => index.search(fallbackQuery, { ...params, matchingStrategy: 'last' }), [prepared]);
}

// Ranking scans must not page through a changing hybrid blend. Keep the
// exhaustive lexical pass separate from the fixed semantic relevance window.
export async function keywordSearch(query, options) {
  const [{indexUid,_cfpSemanticDisabled,_cfpSmartSku,q,...params}]=await prepareConfiguredSearchQueries([{q:query,...options}]);
  return runQuery({indexUid,q,...(q?.trim()?{...params,matchingStrategy:'all'}:params)});
}

// A ranked page may use several count/page queries. Never mix semantic counts
// with keyword hits when an embedding request fails halfway through the plan.
export async function searchPageBatch(queries, mode) {
  const provider = semanticProvider();
  const scoped=await prepareConfiguredSearchQueries(queries);
  const semantic = mode !== false && scoped.some(q => !q._cfpSemanticDisabled&&withSemanticSearch(q,true,provider).hybrid) && (await Promise.all([...new Set(scoped.map(q=>q.indexUid))].map(uid=>isReady(provider,uid)))).every(Boolean);
  const clean=scoped.map(({_cfpSemanticDisabled,_cfpSmartSku,...q})=>withSemanticSearch(q,semantic&&!_cfpSemanticDisabled,provider));
  if (mode === true && !semantic) throw Error('Semantic search mode changed during page retrieval');
  try {
    return { ...(await runBatch(clean)), semantic };
  } catch (error) {
    if (!semantic || mode === true) throw error;
    return { ...(await runBatch(clean.map(({hybrid,...q})=>q))), semantic: false };
  }
}

export async function semanticMultiSearch(queries,{preferKeyword=false}={}) {
  const provider = semanticProvider();
  const scoped=await prepareConfiguredSearchQueries(queries);
  if(preferKeyword){
    const keywordQueries=scoped.map(({_cfpSemanticDisabled,_cfpSmartSku,...query})=>query.q?.trim()?{...query,matchingStrategy:'all'}:query);
    const lexical=await runBatch(keywordQueries);
    if((lexical.results?.[0]?.totalHits??lexical.results?.[0]?.estimatedTotalHits??lexical.results?.[0]?.hits?.length??0)>0)return lexical;
  }
  const readiness=new Map();
  for(const query of scoped)if(!query._cfpSemanticDisabled&&query.q?.trim()&&!readiness.has(query.indexUid))readiness.set(query.indexUid,isReady(provider,query.indexUid));
  const prepared=await Promise.all(scoped.map(async({ _cfpSemanticDisabled,_cfpSmartSku,...query})=>withSemanticSearch(query,!_cfpSemanticDisabled&&await(readiness.get(query.indexUid)||false),provider)));
  return semanticFallback(prepared => runBatch(prepared),prepared);
}
