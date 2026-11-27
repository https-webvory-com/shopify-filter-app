import meiliClient from "./meiliClient.server";
import { getCached } from "./shopCache.server";
import { withSemanticSearch, semanticFallback, semanticProvider } from "../utils/semanticSearch.js";
import {prepareConfiguredSearchQueries} from './searchIndex.server.js';

const fallbackStopwords = new Set(['for', 'the', 'a', 'with']);
const withoutFallbackStopwords = query => String(query || '').split(/\s+/u)
  .filter(token => !fallbackStopwords.has(token.toLowerCase())).join(' ').trim();

// Count a large lexical union without repeatedly sorting its entire prefix.
// Retrieve only the smaller branches, then subtract their exact intersection
// with the largest branch. The budget selects this strategy; it never limits
// the matching products or substitutes an estimated count.
async function countSynonymUnion(indexUid, texts, scope) {
  const {facets,attributesToHighlight,...params}=scope;
  const query=text=>({indexUid,q:text,...params,attributesToRetrieve:[],attributesToHighlight:[],matchingStrategy:'all'});
  const counted=await meiliClient.multiSearch({queries:texts.map(text=>({...query(text),page:1,hitsPerPage:1}))});
  const totals=counted.results?.map(result=>result.totalHits);
  if(totals?.length!==texts.length||totals.some(n=>!Number.isSafeInteger(n)||n<0))return null;
  const capacity=await getCached('synonymCountCapacity:'+indexUid,async()=>
    (await meiliClient.index(indexUid).getSettings()).pagination?.maxTotalHits??1000,30);
  if(totals.some(n=>n>=capacity))return null;
  const largest=totals.indexOf(Math.max(...totals));
  if(totals.reduce((sum,n,i)=>sum+(i===largest?0:n),0)>1000)return null;
  const smaller=texts.map((text,i)=>({text,total:totals[i],i})).filter(branch=>branch.i!==largest&&branch.total>0);
  const ids=new Set();
  if(smaller.length){
    const fetched=await meiliClient.multiSearch({queries:smaller.map(({text,total})=>({...query(text),limit:total,attributesToRetrieve:['id']}))});
    for(const [i,branch]of smaller.entries()){
      const hits=fetched.results?.[i]?.hits;
      if(hits?.length!==branch.total||hits.some(hit=>hit.id==null)||new Set(hits.map(hit=>String(hit.id))).size!==branch.total)throw Error('Synonym matches changed during counting');
      for(const hit of hits)ids.add(String(hit.id));
    }
  }
  let overlap=0;
  if(ids.size){
    const base=query(texts[largest]);
    const result=await meiliClient.multiSearch({queries:[{...base,page:1,hitsPerPage:1,
      filter:[...(Array.isArray(base.filter)?base.filter:[base.filter].filter(Boolean)),`id IN ${JSON.stringify([...ids])}`]}]});
    overlap=result.results?.[0]?.totalHits;
    if(!Number.isSafeInteger(overlap)||overlap<0||overlap>ids.size||overlap>totals[largest])throw Error('Synonym intersection changed during counting');
  }
  return {total:totals[largest]+ids.size-overlap,metadata:counted.results[largest]};
}

// Engine multiword synonyms require a phrase match. Explicit query branches
// also find terms in separate attributes (e.g. White color + Dress title).
async function runQuery({indexUid='products',q,_cfpSynonymQueries,_cfpFieldWeights,...options}) {
  if(_cfpFieldWeights?.length&&!options.sort?.length){
    const base={indexUid,q,_cfpSynonymQueries,...options};
    // Counts and facets come from the complete query, not the sum of overlapping
    // field branches. Count-only tier queries never execute weighted searches.
    if(Array.isArray(options.attributesToRetrieve)&&!options.attributesToRetrieve.length)return runQuery(base);
    const {page,hitsPerPage,offset=0,limit=20,facets,hybrid,vector,...params}=options;
    const start=page!=null||hitsPerPage!=null?Math.max(0,(page??1)-1)*(hitsPerPage??20):offset;
    const take=page!=null||hitsPerPage!=null?(hitsPerPage??20):limit;
    const groups=new Map();
    for(const {attribute,weight} of _cfpFieldWeights){if(!groups.has(weight))groups.set(weight,[]);groups.get(weight).push(attribute);}
    const floor=Math.min(...groups.keys())/2;
    const branches=[{...params,...(hybrid?{hybrid}:{}),...(vector?{vector}:{}),federationOptions:{weight:floor}},
      ...[...groups].map(([weight,attributesToSearchOn])=>({...params,attributesToSearchOn,federationOptions:{weight}}))];
    const texts=[...new Set([q,...(_cfpSynonymQueries||[])])];
    const [count,ranked]=await Promise.all([
      runQuery({...base,page:1,hitsPerPage:1,attributesToRetrieve:[],attributesToHighlight:[]}),
      meiliClient.multiSearch({queries:branches.flatMap(branch=>texts.map(text=>({indexUid,q:text,...branch}))),federation:{offset:start,limit:take}}),
    ]);
    const {page:_page,hitsPerPage:_size,totalPages:_pages,totalHits,estimatedTotalHits,...metadata}=count;
    const total=totalHits??estimatedTotalHits;
    return {...metadata,...ranked,query:q,...(page!=null||hitsPerPage!=null?{page:page??1,hitsPerPage:take,totalHits:total,totalPages:take?Math.ceil(total/take):0}:{offset:start,limit:take,estimatedTotalHits:total}),
      ...(count.facetDistribution?{facetDistribution:count.facetDistribution}:{}),...(count.facetStats?{facetStats:count.facetStats}:{}),
      hits:ranked.hits.map(({_federation,...hit})=>hit)};
  }
  if(!_cfpSynonymQueries?.length)return meiliClient.index(indexUid).search(q,options);
  // Older engines lack federated page/count parameters. Count the deduplicated
  // union through offset pages instead of passing unsupported parameters.
  if(options.page!=null||options.hitsPerPage!=null){
    const {page=1,hitsPerPage=20,offset:_offset,limit:_limit,...scope}=options;
    const start=Math.max(0,page-1)*hitsPerPage,selected=[];let total=0,first;
    if(!scope.hybrid&&Array.isArray(scope.attributesToRetrieve)&&scope.attributesToRetrieve.length===0){
      const counted=await countSynonymUnion(indexUid,[...new Set([q,..._cfpSynonymQueries])],scope);
      if(counted){
        const metadata=scope.facets?.length?await runQuery({indexUid,q,_cfpSynonymQueries,...scope,offset:0,limit:1}):counted.metadata;
        const {estimatedTotalHits,offset,limit,...result}=metadata;
        return {...result,query:q,hits:Array.from({length:Math.min(hitsPerPage,Math.max(0,counted.total-start))},()=>({})),
          totalHits:counted.total,totalPages:hitsPerPage?Math.ceil(counted.total/hitsPerPage):0,page,hitsPerPage};
      }
    }
    for(let offset=0;;offset+=1000){
      const result=await runQuery({indexUid,q,_cfpSynonymQueries,...scope,offset,limit:1000,...(offset?{facets:[],...(!(offset<start+hitsPerPage&&offset+1000>start)?{attributesToRetrieve:['id']}:{})}:{})});
      first??=result;
      for(let i=0;i<result.hits.length;i++)if(offset+i>=start&&offset+i<start+hitsPerPage)selected.push(result.hits[i]);
      total+=result.hits.length;
      if(result.hits.length<1000)break;
      if(offset>=999000)throw Error('Synonym union exceeded exhaustive count budget');
    }
    const {limit,offset,estimatedTotalHits,...result}=first;
    return {...result,hits:selected,totalHits:total,totalPages:hitsPerPage?Math.ceil(total/hitsPerPage):0,page,hitsPerPage};
  }
  const {offset=0,limit=20,facets,...params}=options;
  const federation={offset,limit,...(facets?.length?{facetsByIndex:{[indexUid]:facets},mergeFacets:{maxValuesPerFacet:100000}}:{})};
  const result=await meiliClient.multiSearch({queries:[...new Set([q,..._cfpSynonymQueries])].map(text=>({indexUid,q:text,...params,matchingStrategy:'all'})),federation});
  return {...result,query:q,hits:result.hits.map(({_federation,...hit})=>hit)};
}
async function runBatch(queries){
  if(!queries.some(q=>q._cfpSynonymQueries?.length||q._cfpFieldWeights))return meiliClient.multiSearch({queries});
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

// Full documents for one visible page of a ranked search, read from the
// same configured index the query used. Missing documents are skipped.
export async function getSearchDocuments(query, ids) {
  const [{indexUid}]=await prepareConfiguredSearchQueries([{q:query}]);
  const index=meiliClient.index(indexUid);
  return Promise.all(ids.map(id=>index.getDocument(id).catch(()=>null)));
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
