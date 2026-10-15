import prisma from '../db.server';
import { createHash } from 'node:crypto';
import { getCached } from './shopCache.server';
import { semanticSearch } from './semanticSearch.server';
import { applyMerchandisingRules, buildMeiliIncludeFilters, selectMerchandisingVariant } from './merchandising.server';
import { selectSearchColorVariant } from '../utils/searchColor.js';
import { hydrateCollectionInventory, hydrateCollectionSkus } from '../utils/rankedCollectionPage.js';

const gid = id => `gid://shopify/Product/${String(id).split('/').pop()}`;
const variants = rows => (rows || []).map(v => ({ ...v,
  id: `gid://shopify/ProductVariant/${String(v.id).split('/').pop()}` }));

// Both search surfaces rank the eligible set before allocating page slots.
// Never inject an inactive product or a pin that violates the query's color.
export async function rankSearchResults({ shop, query, options, rule, pinningRule,
  parsedQuery, globalSettings = {}, mergedValues = [], page = 1, limit = 10, facetKeys = [] }) {
  const seen = new Set(), products = [];
  const { limit: ignoredLimit, offset: ignoredOffset, sortBy, facets, attributesToHighlight,
    attributesToRetrieve, ...searchOptions } = options;
  const batchSize = 200;
  const includes = buildMeiliIncludeFilters(rule?.conditions?.filter(c => c.action === 'Include') || []);
  searchOptions.filter = [...(Array.isArray(searchOptions.filter) ? searchOptions.filter : [searchOptions.filter].filter(Boolean)), ...includes];
  const cacheKey = `searchRankingCandidates:${shop}:${createHash('sha256').update(JSON.stringify([query, searchOptions])).digest('hex')}`;
  const candidates = await getCached(cacheKey, async () => {
    const hits = [], ids = new Set();
    let semanticHitCount = 0;
    for (let offset = 0; ; offset += batchSize) {
      const result = await semanticSearch(query, { ...searchOptions, offset, limit: batchSize });
      semanticHitCount += result.semanticHitCount || 0;
      for (const h of result.hits || []) {
        const id = gid(h.id);
        if (ids.has(id)) throw Error('Search results changed while ranking; retry the request');
        ids.add(id); hits.push(h);
      }
      if ((result.hits || []).length < batchSize) {
        if (result.totalHits != null && hits.length !== result.totalHits) throw Error('Incomplete search ranking results');
        break;
      }
    }
    return { hits, semanticHitCount };
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
      products.push({ ...valid.get(id), variants: variants(valid.get(id).variants), _originalIndex: products.length });
    }
  }
  const eligible = products.filter(p => {
    if (p.status && String(p.status).toLowerCase() !== 'active') return false;
    if (globalSettings.showOnlyInStock && !p.variants?.some(v => v.available === true)) return false;
    if (!parsedQuery?.colorIntent?.requested.length) return true;
    const variant = selectSearchColorVariant(p, parsedQuery.colorIntent.values, parsedQuery.colorIntent.requested);
    return variant && (!globalSettings.showOnlyInStock || variant.available !== false);
  });
  if (rule?.conditions?.some(c => c.field === 'SKU')) await hydrateCollectionSkus(eligible, prisma.variant, shop);
  if (rule?.conditions?.some(c => c.field === 'Available')) await hydrateCollectionInventory(eligible, prisma.variant);
  const eligibleIds = new Set(eligible.map(p => p.id));
  const effectivePins = pins.filter(p => eligibleIds.has(p.id));
  const effectiveRule = pinningRule ? { ...pinningRule, products: effectivePins } : null;
  const ranked = applyMerchandisingRules(eligible, rule, sortBy || 'relevance', effectiveRule, mergedValues,
    { ...globalSettings, preserveSearchRelevance: true });
  const effectiveIds = new Set(effectivePins.map(p => p.id));
  const facetDistribution = {}, facetStats = {};
  for (const key of facetKeys) {
    const counts = {};
    let minimum = Infinity, maximum = -Infinity;
    for (const p of ranked) {
      let value = p[key];
      if (value == null && key.startsWith('option_')) {
        const optionName = key.slice(7).toLowerCase();
        let productOptions = p.options || [];
        if (typeof productOptions === 'string') { try { productOptions = JSON.parse(productOptions); } catch { productOptions = []; } }
        value = productOptions.find(o => o.name?.toLowerCase() === optionName)?.values;
      }
      for (const v of new Set((Array.isArray(value) ? value.flat() : [value]).filter(v => v != null && v !== ''))) {
        const text = String(v);
        counts[text] = (counts[text] || 0) + 1;
        if (key === 'priceMin' && Number.isFinite(Number(v))) {
          minimum = Math.min(minimum, Number(v)); maximum = Math.max(maximum, Number(v));
        }
      }
    }
    facetDistribution[key] = counts;
    if (Number.isFinite(minimum)) facetStats[key] = { min: minimum, max: maximum };
  }
  return { products: ranked.slice((page - 1) * limit, page * limit).map(p => {
    const selection = !parsedQuery?.colorIntent?.requested.length ? selectMerchandisingVariant(p, rule, mergedValues) : null;
    return { ...p, isPinned: effectiveIds.has(p.id), ...(selection ? {
      selectedVariantId: selection.variantId, merchandisingImage: selection.imageUrl || p.merchandisingImage,
      images: selection.imageUrl ? [selection.imageUrl, ...(p.images || []).filter(image => image !== selection.imageUrl)] : p.images,
    } : {}) };
  }),
    total: ranked.length, pinnedCount: effectiveIds.size, semanticHitCount, facetDistribution, facetStats };
}
