import client from './meiliClient.server';
import prisma from '../db.server';
import { getCached } from './shopCache.server';
import { searchPageBatch } from './semanticSearch.server';
import { compileSearchPagePlan } from '../utils/searchPagePlan.js';
import { SEARCH_PROJECTION_VERSION, SEARCH_FILTER_FIELDS, searchExactToken, decodeSearchFacet } from '../utils/searchIndexProjection.js';
import { buildMeiliIncludeFilters, applyMerchandisingRules, selectMerchandisingVariant } from './merchandising.server';
import { selectSearchColorVariant } from '../utils/searchColor.js';
import {isProductCodeQuery,productMatchesCode} from '../utils/skuSearch.js';
import { pinnedProductMatchesAppliedIntent } from '../utils/searchPinnedIntent.js';
import {createFacetValueMapper,facetValueKey,groupFacetValues} from '../utils/facetNormalization.js';

const gid = id => 'gid://shopify/Product/' + String(id).split('/').pop();
const normal = p => ({ ...p, id: gid(p.id),
  variants: (p.variantPrices || p.variants || []).map(v => ({ ...v, id: 'gid://shopify/ProductVariant/' + String(v.id).split('/').pop() })),
  collections: p.collection_titles?.map(title => ({ collection: { title } })) || p.collections || [] });
const supports = (list, field) => list.includes('*') || list.includes(field);

function mergeFacets(target, stats, distribution = {}, sourceStats = {}) {
  for (const [field, values] of Object.entries(distribution)) {
    target[field] ||= {};
    for (const [value, count] of Object.entries(values)) target[field][value] = (target[field][value] || 0) + count;
  }
  for (const [field, bounds] of Object.entries(sourceStats)) stats[field] = {
    min: Math.min(stats[field]?.min ?? Infinity, bounds.min), max: Math.max(stats[field]?.max ?? -Infinity, bounds.max),
  };
}

// Returns null when the deployed index/rule cannot execute this plan exactly.
// No index configuration or product writes occur on a visitor request.
export async function rankNativeSearchPage({ shop, query, options, rule, pinningRule, parsedQuery,
  globalSettings = {}, mergedValues = [], page = 1, limit = 10, facetKeys = [] }) {
  // The admin picker intentionally requests the full eligible list.
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null;
  const sortBy = options.sortBy || 'relevance';
  const plan = compileSearchPagePlan(rule, sortBy, globalSettings, mergedValues);
  if (!plan) return null;
  let saved = [];
  try { const rows = typeof pinningRule?.products === 'string' ? JSON.parse(pinningRule.products) : pinningRule?.products;
    if (Array.isArray(rows)) saved = rows.filter(p => p?.id).map(p => ({ ...p, id: gid(p.id) }));
  } catch { /* same malformed-legacy-pin behavior as the compatibility ranker */ }
  const pinIds = [...new Set(saved.map(p => p.id))];
  // A price/date/title sort overriding pins needs a merged sort, not a prefix.
  if (plan.sort.length && pinIds.length && globalSettings.prioritizeSortOverPinning === true) return null;
  const settings = await getCached('searchNativeCapabilities', () => client.index('products').getSettings(), 30);
  // Meilisearch normally ranks word matches ahead of its `sort` criterion.
  // That cannot reproduce our absolute price/date/title ordering. Never
  // change shared ranking settings on a request or silently weaken sorting.
  if (plan.sort.length && settings.rankingRules?.[0] !== 'sort') return null;
  const filterable = settings.filterableAttributes || [], sortable = settings.sortableAttributes || [];
  if ([...plan.required, ...SEARCH_FILTER_FIELDS].some(f => !supports(filterable, f)) ||
      plan.sort.some(s => !supports(sortable, s.split(':')[0]))) return null;
  const ready = await getCached(`searchNativeReady:${shop}:${JSON.stringify([...facetKeys].sort())}`, async () => {
    const result = await client.index('products').search('', { filter: [`shop = ${JSON.stringify(shop)}`, "status = 'ACTIVE'",
      `(NOT (cfpSearchVersion = ${SEARCH_PROJECTION_VERSION})${facetKeys.length ? ` OR cfpSearchFacetUnsupported IN ${JSON.stringify(facetKeys)}` : ''})`], hitsPerPage: 1, page: 0, attributesToRetrieve: [] });
    return result.totalHits === 0;
  }, 30);
  if (!ready) return null;
  const { limit: ignoredLimit, offset: ignoredOffset, page: ignoredPage, hitsPerPage: ignoredPageSize,
    sortBy: ignoredSort, sort: ignoredEngineSort, facets: ignoredFacets, ...baseOptions } = options;
  const base = [...(Array.isArray(options.filter) ? options.filter : [options.filter].filter(Boolean)),
    ...buildMeiliIncludeFilters(rule?.conditions?.filter(c => c.action === 'Include') || [])];
  if (globalSettings.showOnlyInStock) base.push('cfpSearchHasStock = true');
  if (parsedQuery?.colorIntent?.requested.length) {
    const values = parsedQuery.colorIntent.values.map(v => searchExactToken(String(v).trim().toLowerCase()));
    if (!values.length) base.push('(shop EXISTS AND NOT shop EXISTS)');
    else base.push(`${globalSettings.showOnlyInStock ? 'cfpSearchAvailableColors' : 'cfpSearchColors'} IN ${JSON.stringify(values)}`);
  }
  if (pinIds.length) base.push(`NOT (id IN ${JSON.stringify(pinIds.map(id => id.split('/').pop()))})`);
  let pins = [];
  if (pinIds.length) {
    const rows = await prisma.product.findMany({ where: { shop, status: { equals: 'active', mode: 'insensitive' },
      id: { in: pinIds } }, include: { variants: true } });
    const valid = new Map(rows.map(p => [gid(p.id), normal(p)]));
    for (const id of pinIds) {
      const p = valid.get(id);
      if(parsedQuery?.skuProductIds?.length&&!parsedQuery.skuProductIds.includes(id.split('/').pop()))continue;
      if(p&&isProductCodeQuery(query)&&!productMatchesCode(p,query))continue;
      if (!p || (globalSettings.showOnlyInStock && !p.variants.some(v => v.available === true))) continue;
      if (!pinnedProductMatchesAppliedIntent(p, parsedQuery)) continue;
      if (parsedQuery?.colorIntent?.requested.length) {
        const v = selectSearchColorVariant(p, parsedQuery.colorIntent.values, parsedQuery.colorIntent.requested);
        if (!v || (globalSettings.showOnlyInStock && v.available === false)) continue;
      }
      pins.push(p);
    }
  }
  const effective = pinningRule ? { ...pinningRule, products: saved.filter(p => pins.some(row => row.id === p.id)) } : null;
  // Protect validated explicit pins from exclusions and retain merchant images.
  pins = applyMerchandisingRules(pins, null, 'relevance', effective, mergedValues, { preserveSearchRelevance: true });
  const queries = plan.tiers.map(t => ({ ...baseOptions, indexUid: 'products', q: query,
    filter: [...base, ...t.filter], ...(plan.sort.length ? { sort: plan.sort } : {}) }));
  const maxHits = settings.pagination?.maxTotalHits ?? 1000;
  async function read(mode) {
    // Older engines report zero semantic totalHits for page=0 even when a
    // normal search has hits. Page 1 with an empty projection gives correct
    // hybrid counts without transferring any product fields.
    const counts = await searchPageBatch(queries.map(q => ({ ...q, hitsPerPage: 1, page: 1,
      attributesToRetrieve: [], ...(facetKeys.length ? { facets: ['cfpSearchFacetValues'] } : {}) })), mode);
    if (counts.results.length !== queries.length) throw Error('Incomplete search tier counts');
    const totals = counts.results.map(r => {
      if (!Number.isSafeInteger(r.totalHits) || r.totalHits < 0 || r.totalHits > maxHits) throw Error('Search tier exceeds index pagination capacity');
      return r.totalHits;
    });
    const total = pins.length + totals.reduce((sum, n) => sum + n, 0);
    let skip = (page - 1) * limit, remaining = limit;
    const products = pins.slice(skip, skip + remaining).map(p => ({ ...p, isPinned: true }));
    remaining -= products.length;
    skip = Math.max(0, skip - pins.length);
    const selected = [];
    for (let i = 0; i < queries.length && remaining; i++) {
      if (skip >= totals[i]) { skip -= totals[i]; continue; }
      const take = Math.min(remaining, totals[i] - skip);
      // Read the prefix once, then slice. Avoid the hybrid offset overlap that
      // caused the production failure; never crawl through previous batches.
      selected.push({ query: { ...queries[i], offset: 0, limit: skip + take,
        ...(skip ? { attributesToRetrieve: ['id'] } : {}) }, skip, take });
      remaining -= take; skip = 0;
    }
    if (selected.length) {
      const result = await searchPageBatch(selected.map(p => p.query), counts.semantic);
      for (let i = 0; i < selected.length; i++) {
        const { skip, take } = selected[i];
        const hits = result.results[i]?.hits?.slice(skip, skip + take);
        if (hits?.length !== take) throw Error('Search changed between count and page');
        products.push(...hits.map(p => ({ ...normal(p), isPinned: false, _needsHydration: skip > 0 })));
      }
    }
    const hydrateIds = products.filter(p => p._needsHydration).map(p => p.id.split('/').pop());
    if (hydrateIds.length) {
      const hydrated = await client.index('products').search('', { filter: [`shop = ${JSON.stringify(shop)}`,
        "status = 'ACTIVE'", `id IN ${JSON.stringify(hydrateIds)}`], limit: hydrateIds.length });
      const byId = new Map(hydrated.hits.map(p => [gid(p.id), p]));
      for (let i = 0; i < products.length; i++) if (products[i]._needsHydration) {
        if (!byId.has(products[i].id)) throw Error('Search page product disappeared');
        products[i] = { ...normal(byId.get(products[i].id)), isPinned: false };
      }
    }
    if (new Set(products.map(p => p.id)).size !== products.length) throw Error('Search page contains duplicate products');
    const distribution = {}, stats = {};
    for (const r of counts.results) {
      const values=r.facetDistribution?.cfpSearchFacetValues || {};
      if(facetKeys.length && Object.keys(values).length >= (settings.faceting?.maxValuesPerFacet ?? 100)) throw Error('Search facets exceed index facet capacity');
      for(const [token,count] of Object.entries(values)) {
        const [field,value]=decodeSearchFacet(token);
        if(!facetKeys.includes(field))continue;
        mergeFacets(distribution,stats,{[field]:{[value]:count}},field==='priceMin'&&Number.isFinite(Number(value))?{[field]:{min:Number(value),max:Number(value)}}:{});
      }
    }
    // Explicit pins can be outside the query. Add each validated pin once.
    for (const p of pins) for (const field of facetKeys) {
      let value = p[field];
      if (value == null && field.startsWith('option_')) value = p.options?.find(o => o.name?.toLowerCase() === field.slice(7).toLowerCase())?.values;
      const values = [...new Set((Array.isArray(value) ? value.flat() : [value]).filter(v => v != null && v !== '').map(String))];
      mergeFacets(distribution, stats, { [field]: Object.fromEntries(values.map(v => [v, 1])) },
        field === 'priceMin' && value != null && value !== '' && Number.isFinite(Number(value)) ? { [field]: { min: Number(value), max: Number(value) } } : {});
    }
    const normalizedFacetCounts={}, groups=[],mapFacetValue=createFacetValueMapper(mergedValues);
    for(const [field,values] of Object.entries(distribution)){
      const type=({vendor:'vendor',productType:'product_type',tags:'tags',title:'title'})[field]||
        (field.startsWith('option_')?field.slice(7):field.startsWith('metafield_')?field.slice(10):null);
      if(type)for(const group of groupFacetValues(type,Object.keys(values),mergedValues,mapFacetValue))
        if(group.rawValues.length>1)groups.push({...group,field,type});
    }
    if(groups.length){
      // Tiers are disjoint. Count the OR of each label's encoded raw values
      // inside each existing tier, retaining its exclusions/query/market scope.
      const unionQueries=groups.flatMap(group=>queries.map(q=>({...q,filter:[...q.filter,
        'cfpSearchFacetValues IN '+JSON.stringify(group.rawValues.map(value=>searchExactToken(JSON.stringify([group.field,value]))))],
        hitsPerPage:1,page:1,attributesToRetrieve:[]})));
      const key='normalizedNativeFacetCounts:v1:'+shop+':'+JSON.stringify([counts.semantic,unionQueries]);
      const read=()=>searchPageBatch(unionQueries,counts.semantic);
      const result=key.length<=32768?await getCached(key,read,30,{maxBytes:262144}):await read();
      for(const [index,group] of groups.entries()){
        let count=0;
        for(let tier=0;tier<queries.length;tier++){
          const total=result.results[index*queries.length+tier]?.totalHits;
          if(!Number.isSafeInteger(total)||total<0)throw Error('Incomplete normalized search facet count');
          count+=total;
        }
        for(const p of pins){
          let value=p[group.field];
          if(value==null&&group.field.startsWith('option_'))value=p.options?.find(o=>o.name?.toLowerCase()===group.field.slice(7).toLowerCase())?.values;
          if((Array.isArray(value)?value.flat():[value]).some(v=>v!=null&&facetValueKey(mapFacetValue(group.type,String(v)))===group.key))count++;
        }
        (normalizedFacetCounts[group.field]||={})[group.key]=count;
      }
    }
    return { products: products.map((row, i) => {
      // Preserve score/image metadata on the visible page. Engine groups have
      // already allocated the slots; this never ranks a catalog in Node.
      const p = applyMerchandisingRules([{ ...row }], rule, sortBy, effective, mergedValues,
        { ...globalSettings, preserveSearchRelevance: true })[0];
      if (!p) throw Error('Index merchandising projection is stale');
      if (globalSettings.showOnlyInStock && !p.variants.some(v => v.available === true)) throw Error('Index availability projection is stale');
      if (parsedQuery?.colorIntent?.requested.length) {
        const v = selectSearchColorVariant(p, parsedQuery.colorIntent.values, parsedQuery.colorIntent.requested);
        if (!v || (globalSettings.showOnlyInStock && v.available === false)) throw Error('Index color projection is stale');
      }
      const selection = !parsedQuery?.colorIntent?.requested.length ? selectMerchandisingVariant(p, rule, mergedValues) : null;
      const { _needsHydration, ...visible } = p;
      return { ...visible, _originalIndex: (page - 1) * limit + i, ...(selection ? {
        selectedVariantId: selection.variantId, merchandisingImage: selection.imageUrl || p.merchandisingImage,
        images: selection.imageUrl ? [selection.imageUrl, ...(p.images || []).filter(img => img !== selection.imageUrl)] : p.images,
      } : {}) };
    }), total, pinnedCount: pins.length, semanticHitCount: counts.semantic ? 1 : 0,
    facetDistribution: distribution, facetStats: stats, normalizedFacetCounts, rankingMode: 'native' };
  }
  try { return await read(); }
  catch { return read(false); } // restart counts AND hits together as keyword
}
