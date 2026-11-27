import prisma from '../db.server';
import { createHash } from 'node:crypto';
import { getCached } from './shopCache.server';
import { semanticSearch, keywordSearch, getSearchDocuments } from './semanticSearch.server';
import { applyMerchandisingRules, buildMeiliIncludeFilters, selectMerchandisingVariant, createMerchandisingComparator } from './merchandising.server';
import { selectSearchColorVariant } from '../utils/searchColor.js';
import { hydrateCollectionInventory, hydrateCollectionSkus } from '../utils/rankedCollectionPage.js';
import { rankNativeSearchPage } from './nativeSearchPage.server.js';
import {isProductCodeQuery,productMatchesCode} from '../utils/skuSearch.js';
import { pinnedProductMatchesAppliedIntent } from '../utils/searchPinnedIntent.js';
import {savedVariantPriceSelections} from '../utils/availableVariants.js';
import {priceSortVariant} from '../utils/savedMarketPricing.js';
import {createFacetValueMapper,facetValueKey} from '../utils/facetNormalization.js';

// Ranking only needs these fields. Transferring full documents for every
// match (thousands for broad queries) made sorted results pages very slow.
const rankingFields = ['id', 'shop', 'status', 'available', 'title', 'vendor', 'productType', 'tags', 'priceMin',
  'inventoryTotal', 'variantPrices', 'options', 'images', 'collections', 'collection_titles', 'bestSellingScore',
  'trendingScore', 'createdAt', 'rating', 'metafield_reviews.rating'];
const knownRuleFields = new Set(['tags', 'vendor', 'product type', 'product', 'collections', 'price', 'date', 'sku',
  'rating', 'id', 'available', 'discount', 'percent sales']);
export function searchRankingFields(rule, facetKeys = []) {
  for (const condition of rule?.conditions || []) {
    const field = String(condition.field || '').toLowerCase();
    if (!knownRuleFields.has(field) && !/option|color|size|title/.test(field)) return null;
  }
  return [...new Set([...rankingFields, ...facetKeys])];
}

// Fetch complete documents for the visible page only, in ranked order.
async function hydrateSearchPage(products, query, shop) {
  const missing = products.filter(p => !p._fromDb);
  if (!missing.length || typeof getSearchDocuments !== 'function') return products;
  const byId = new Map((await getSearchDocuments(query, missing.map(p => String(p.id).split('/').pop())))
    .filter(d => d && (!d.shop || d.shop === shop)).map(d => [gid(d.id), d]));
  return products.map(p => {
    const doc = byId.get(p.id);
    return doc ? { ...doc, ...p, variants: p.variants, images: p.images ?? doc.images } : p;
  });
}

const gid = id => `gid://shopify/Product/${String(id).split('/').pop()}`;
const variants = rows => (rows || []).map(v => ({ ...v,
  id: `gid://shopify/ProductVariant/${String(v.id).split('/').pop()}` }));

// Both search surfaces rank the eligible set before allocating page slots.
// Never inject an inactive product or a pin that violates the query's color.
export async function rankSearchResults({ shop, query, options, rule, pinningRule,
  parsedQuery, globalSettings = {}, mergedValues = [], page = 1, limit = 10, facetKeys = [], membershipOnly = false, stableMembership = false, variantPriceContext = null }) {
  try {
    const result = !membershipOnly && !stableMembership && !variantPriceContext && await rankNativeSearchPage({ shop, query, options, rule, pinningRule,
      parsedQuery, globalSettings, mergedValues, page, limit, facetKeys });
    if (result) return result;
  } catch (error) {
    console.error('Native search page unavailable; using compatible ranking:', error.name);
  }
  const seen = new Set(), products = [];
  const { limit: ignoredLimit, offset: ignoredOffset, sort: ignoredSort, sortBy, facets, attributesToHighlight,
    attributesToRetrieve, ...searchOptions } = options;
  // The admin pin picker only consumes IDs. Keep color eligibility fields,
  // but do not transfer images, descriptions, vectors or other card data.
  const projected = !membershipOnly && searchRankingFields(rule, facetKeys);
  if (membershipOnly) searchOptions.attributesToRetrieve = parsedQuery?.colorIntent?.requested.length
    ? ['id', 'status', 'options', 'variantPrices', 'variants'] : ['id', 'status'];
  else if (projected) searchOptions.attributesToRetrieve = projected;
  const batchSize = 1000;
  const semanticWindow = 200;
  const includes = buildMeiliIncludeFilters(rule?.conditions?.filter(c => c.action === 'Include') || []);
  searchOptions.filter = [...(Array.isArray(searchOptions.filter) ? searchOptions.filter : [searchOptions.filter].filter(Boolean)), ...includes];
  const cacheKey = `searchRankingCandidates:${shop}:${createHash('sha256').update(JSON.stringify(['sort-independent-membership-v3', query, searchOptions])).digest('hex')}`;
  const candidates = await getCached(cacheKey, async () => {
    const hits = [], ids = new Set();
    // Semantic search can match the entire catalog. Use one fixed relevance
    // window, shared by both surfaces/pages, rather than scanning its tail.
    // Retain EVERY lexical match, including late products targeted by rules.
    const [semantic, firstKeyword] = await Promise.all([
      semanticSearch(query, { ...searchOptions, offset: 0, limit: semanticWindow }),
      keywordSearch(query, { ...searchOptions, offset: 0, limit: batchSize }),
    ]);
    const append = result => {
      for (const h of result.hits || []) {
        const id = gid(h.id);
        if (ids.has(id)) continue;
        ids.add(id); hits.push(h);
      }
    };
    append(semantic);
    const keywordIds = new Set((firstKeyword.hits || []).map(h => gid(h.id)));
    append(firstKeyword);
    let result = firstKeyword;
    for (let offset = batchSize; (result.hits || []).length === batchSize; offset += batchSize) {
      result = await keywordSearch(query, { ...searchOptions, offset, limit: batchSize });
      const previousSize = keywordIds.size;
      for (const h of result.hits || []) keywordIds.add(gid(h.id));
      if ((result.hits || []).length && keywordIds.size === previousSize) {
        throw Error('Keyword search pagination did not advance');
      }
      append(result);
    }
    if (result.totalHits != null && keywordIds.size !== result.totalHits) {
      throw Error('Incomplete keyword search ranking results');
    }
    return { hits, semanticHitCount: semantic.semanticHitCount || 0 };
  }, 15);
  const semanticHitCount = candidates.semanticHitCount;
  for (const h of candidates.hits) {
    const id = gid(h.id);
    seen.add(id);
    products.push({ ...h, id, _originalIndex: products.length,
      variants: variants(h.variantPrices || h.variants),
      collections: h.collection_titles?.map(title => ({ collection: { title } })) || h.collections || [] });
  }
  let pins = [];
  try {
    const saved = typeof pinningRule?.products === 'string' ? JSON.parse(pinningRule.products) : pinningRule?.products;
    if (Array.isArray(saved)) pins = saved.filter(p => p?.id).map(p => ({ ...p, id: gid(p.id) }));
  } catch { /* Malformed legacy pins must not make organic search unavailable. */ }
  const pinIds = [...new Set(pins.map(p => p.id))];
  if (pinIds.length) {
    const rows = await prisma.product.findMany({ where: { shop,
      status: { equals: 'active', mode: 'insensitive' }, id: { in: pinIds } }, include: { variants: true } });
    const valid = new Map(rows.map(p => [p.id, p]));
    // DB validation is authoritative for saved pins, including deleted/stale hits.
    for (let i = products.length - 1; i >= 0; i--) {
      if (pinIds.includes(products[i].id)) products.splice(i, 1);
    }
    const sortOverridesPins = sortBy && !['relevance', 'r', 'best-selling', 'bestselling', 'manual'].includes(sortBy)
      && globalSettings.prioritizeSortOverPinning === true;
    for (const id of pinIds) if (valid.has(id) && (!sortOverridesPins || seen.has(id))) {
      products.push({ ...valid.get(id), variants: variants(valid.get(id).variants), _fromDb: true, _originalIndex: products.length });
    }
  }
  const eligible = products.filter(p => {
    if (pinIds.includes(p.id) && !pinnedProductMatchesAppliedIntent(p, parsedQuery)) return false;
    if(parsedQuery?.skuProductIds?.length&&!parsedQuery.skuProductIds.includes(String(p.id).split('/').pop()))return false;
    if(isProductCodeQuery(query)&&pinIds.includes(p.id)&&!productMatchesCode(p,query))return false;
    if (p.status && String(p.status).toLowerCase() !== 'active') return false;
    if (globalSettings.showOnlyInStock && !p.variants?.some(v => v.available === true)) return false;
    if (!parsedQuery?.colorIntent?.requested.length) return true;
    const variant = selectSearchColorVariant(p, parsedQuery.colorIntent.values, parsedQuery.colorIntent.requested);
    return variant && (!globalSettings.showOnlyInStock || variant.available !== false);
  });
  if (membershipOnly) return { products: eligible.map(p => ({ id: p.id })), total: eligible.length };
  if(variantPriceContext){
    const ids=eligible.map(p=>p.id);
    const key='searchVariantSelections:'+shop+':'+createHash('sha256').update(JSON.stringify([variantPriceContext,ids])).digest('hex');
    const selections=typeof prisma.$queryRaw==='function'
      ? new Map(await getCached(key,async()=>ids.length?[...await savedVariantPriceSelections(prisma,{shop,ids,context:variantPriceContext})]:[],30)) : null;
    for(const product of eligible){
      const selected=selections?selections.get(product.id.split('/').pop()):priceSortVariant(product,variantPriceContext);
      // Retry a concurrent price change; never silently shrink just one sort.
      if(!selected)throw Error('Search price eligibility changed; retry the search');
      product.priceSortSelection=selected;
    }
  }
  if (rule?.conditions?.some(c => c.field === 'SKU')) await hydrateCollectionSkus(eligible, prisma.variant, shop);
  if (rule?.conditions?.some(c => c.field === 'Available')) await hydrateCollectionInventory(eligible, prisma.variant);
  const eligibleIds = new Set(eligible.map(p => p.id));
  const effectivePins = pins.filter(p => eligibleIds.has(p.id));
  const effectiveRule = pinningRule ? { ...pinningRule, products: effectivePins } : null;
  const ranked = applyMerchandisingRules(eligible, rule, sortBy || 'relevance', effectiveRule, mergedValues,
    { ...globalSettings, preserveSearchRelevance: true });
  if(variantPriceContext){
    // Rule eligibility/scoring above retains its original price semantics.
    // Only the ordering projection uses the matching market variant's price.
    const sortRows=new Map(ranked.map(p=>[p.id,{...p,priceMin:p.priceSortSelection.price}]));
    const compare=createMerchandisingComparator(sortBy,effectivePins.map(p=>p.id),{...globalSettings,preserveSearchRelevance:true});
    ranked.sort((a,b)=>compare(sortRows.get(a.id),sortRows.get(b.id))||a.id.localeCompare(b.id));
  }
  const effectiveIds = new Set(effectivePins.map(p => p.id));
  const facetDistribution = {}, facetStats = {}, normalizedFacetCounts = {};
  const mapFacetValue=createFacetValueMapper(mergedValues);
  for (const key of facetKeys) {
    const counts = {}, normalizedCounts = {};
    const type=({vendor:'vendor',productType:'product_type',tags:'tags',title:'title'})[key]||
      (key.startsWith('option_')?key.slice(7):key.startsWith('metafield_')?key.slice(10):null);
    let minimum = Infinity, maximum = -Infinity;
    for (const p of ranked) {
      let value = p[key];
      if (value == null && key.startsWith('option_')) {
        const optionName = key.slice(7).toLowerCase();
        let productOptions = p.options || [];
        if (typeof productOptions === 'string') { try { productOptions = JSON.parse(productOptions); } catch { productOptions = []; } }
        value = productOptions.find(o => o.name?.toLowerCase() === optionName)?.values;
      }
      const normalizedValues=new Set();
      for (const v of new Set((Array.isArray(value) ? value.flat() : [value]).filter(v => v != null && v !== ''))) {
        const text = String(v);
        counts[text] = (counts[text] || 0) + 1;
        if(type)normalizedValues.add(facetValueKey(mapFacetValue(type,text)));
        if (key === 'priceMin' && Number.isFinite(Number(v))) {
          minimum = Math.min(minimum, Number(v)); maximum = Math.max(maximum, Number(v));
        }
      }
      for(const value of normalizedValues)normalizedCounts[value]=(normalizedCounts[value]||0)+1;
    }
    facetDistribution[key] = counts;
    if(type)normalizedFacetCounts[key]=normalizedCounts;
    if (Number.isFinite(minimum)) facetStats[key] = { min: minimum, max: maximum };
  }
  const pageProducts = ranked.slice((page - 1) * limit, page * limit);
  const visible = projected ? await hydrateSearchPage(pageProducts, query, shop) : pageProducts;
  return { products: visible.map(({ _fromDb, ...p }) => {
    const selection = !parsedQuery?.colorIntent?.requested.length ? selectMerchandisingVariant(p, rule, mergedValues) : null;
    return { ...p, isPinned: effectiveIds.has(p.id), ...(selection ? {
      selectedVariantId: selection.variantId, merchandisingImage: selection.imageUrl || p.merchandisingImage,
      images: selection.imageUrl ? [selection.imageUrl, ...(p.images || []).filter(image => image !== selection.imageUrl)] : p.images,
    } : {}) };
  }),
    total: ranked.length, pinnedCount: effectiveIds.size, semanticHitCount, facetDistribution, facetStats, normalizedFacetCounts, rankingMode: 'compatible' };
}
