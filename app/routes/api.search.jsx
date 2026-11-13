import { parseQuery } from "../services/queryParser.server.js";
import { selectSearchColorVariant } from "../utils/searchColor.js";
import { spellingCorrection } from "../utils/spellingCorrection.js";
import { buildSearchSuggestions } from "../utils/searchSuggestions.js";
import { getActiveSuggestionBlacklist } from '../services/suggestionBlacklist.server.js';
import { data } from "react-router";
import prisma from "../db.server";
import { getActivePinningRuleForSearch, getActiveRuleForSearch } from "../services/merchandising.server";
import { rankSearchResults } from "../services/searchRanking.server.js";
import meiliClient from "../services/meiliClient.server";
import { getFilterGlobalSettings } from "../services/filterSettings.server";
import { getCached } from "../services/shopCache.server";
import { rateLimit } from "../services/rateLimiter.server";
import { semanticSearch } from "../services/semanticSearch.server";
import { instantSearchCard, INSTANT_SEARCH_INDEX_FIELDS } from "../utils/instantSearchCard.js";
import { createHash } from 'node:crypto';
import { searchCacheHeaders } from '../utils/searchCachePolicy.js';
import {getSearchIndexContext,configuredSuggestions} from '../services/searchIndex.server.js';
import {publicSearchProduct} from '../utils/searchConfiguration.js';
import {marketPriceIntentReady} from '../services/marketPriceCoverage.server.js';
/**
 * API Endpoint: /api/search (Mapped to /apps/filter/search via App Proxy)
 * Method: GET
 * Purpose: Returns fast search results using Meilisearch, merging Pinned products.
 */
export const loader = async ({ request }) => {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  let query = url.searchParams.get("q") || "";
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "10", 10) || 10));
  const sortBy = url.searchParams.get("sortBy");

  if (!shop) {
    return data({ error: "Missing shop parameter" }, { status: 400 });
  }

  const isAllowed = await rateLimit(request);
  if (!isAllowed) {
    return data({ error: "Too Many Requests" }, {
      status: 429,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }

  try {
    const searchQuery = query ? query.trim() : "";
    const [globalSettings, parsedQuery, pinningRule, merchandisingRule, searchContext] = await Promise.all([
      getCached(`globalSettings:${shop}`, () => getFilterGlobalSettings(shop)),
      searchQuery ? parseQuery(searchQuery, shop) : null,
      getActivePinningRuleForSearch(shop, query, "instant"),
      getActiveRuleForSearch(shop, query, (url.searchParams.get('customer_tags') || '').split(',').map(t => t.trim()).filter(Boolean), url.searchParams.get('locale') || ''),
      getSearchIndexContext(shop),
    ]);
    const bootstrapMs = Date.now() - startedAt;
    let organicProducts = [];

    const intent = parsedQuery?.intent;
    let cleanSearchQuery = parsedQuery?.skuProductIds?.length ? '' : searchQuery;
    let effectiveSort = sortBy || null;

    let meiliFilters = [`shop = '${shop.replace(/'/g, "\\'")}'`, "status = 'ACTIVE'"];
    const emptyPinnedIds=!searchQuery&&searchContext.settings?.instantLayout==='fullscreen'?(searchContext.settings.emptySearchProducts||[]).map(product=>product.id.split('/').pop()):[];
    if(emptyPinnedIds.length)meiliFilters.push('id IN '+JSON.stringify(emptyPinnedIds));
    if(parsedQuery?.skuProductIds?.length)meiliFilters.push('id IN '+JSON.stringify(parsedQuery.skuProductIds));

    if (parsedQuery?.colorFilter) meiliFilters.push(parsedQuery.colorFilter);

    if (globalSettings?.showOnlyInStock) {
      meiliFilters.push(`available = true`);
    }

    const country = String(url.searchParams.get('country') || '').toUpperCase();
    const appliedIntent = { price: false, size: false, country };
    let marketPriceField = null;
    if (intent?.price || intent?.size || intent?.sortHint || /price-(?:ascending|descending)/.test(sortBy || '')) {
      const fields = await getCached(`searchFilterableFields:${searchContext.uid}`, () =>
        meiliClient.index(searchContext.uid).getFilterableAttributes(), 60).catch(() => []);
      const priceField = /^[A-Z]{2}$/.test(country) ? `marketAvailablePriceMin_${country}` : null;
      if (searchContext.uid === 'products' && priceField && fields.includes(priceField) &&
          await marketPriceIntentReady(shop, country))
        marketPriceField = priceField;
      if (intent?.price && marketPriceField) {
        if (intent.price.min != null) meiliFilters.push(`${marketPriceField} >= ${intent.price.min}`);
        if (intent.price.max != null)
          meiliFilters.push(`${marketPriceField} ${intent.price.maxExclusive ? '<' : '<='} ${intent.price.max}`);
        appliedIntent.price = true;
      }
      const sizeField = fields.find(field => /^option_size$/i.test(field));
      if (intent?.size && sizeField) {
        meiliFilters.push(`${sizeField} = ${JSON.stringify(intent.size)}`);
        appliedIntent.size = true;
      }
      if (!sortBy && intent?.sortHint && marketPriceField) effectiveSort = intent.sortHint;
    }
    if (parsedQuery) parsedQuery.appliedIntent = appliedIntent;
    if (!parsedQuery?.skuProductIds?.length && intent &&
        (!intent.price || appliedIntent.price) && (!intent.size || appliedIntent.size) &&
        (!intent.sortHint || effectiveSort === intent.sortHint)) cleanSearchQuery = intent.residualQuery;
    if (parsedQuery?.colorIntent?.requested.length) {
      // The color variant filter makes the detected color word redundant in text retrieval.
      const colorWords = parsedQuery.colorIntent.queryWords || parsedQuery.colorIntent.requested;
      for (const word of colorWords) cleanSearchQuery = cleanSearchQuery
        .replace(new RegExp(`(^|\\s)${String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'ig'), ' ');
      cleanSearchQuery = cleanSearchQuery.replace(/\s+/g, ' ').trim();
    }

    const rawSuggestionLimit = url.searchParams.get('suggestionLimit');
    const suggestionLimit = rawSuggestionLimit !== null && /^\d+$/.test(rawSuggestionLimit) ? Math.min(10, Number(rawSuggestionLimit)) : 6;
    // Search settings with a dedicated index already provide suggestions.
    // Start that read alongside product ranking and avoid three legacy facet
    // searches when the configured index is ready.
    const configuredSuggestionPromise = suggestionLimit > 0
      ? configuredSuggestions(shop, searchQuery, suggestionLimit, meiliFilters)
          .catch(error => { console.error('Configured search suggestions unavailable:', error.name); return []; })
      : Promise.resolve([]);

    let meiliSearchParams = {
        _cfpSearchSurface:true,
        filter: meiliFilters,
        limit: limit + 20, // Request extra to compensate for post-filtering
        facets: ["tags", "productType"],
        attributesToHighlight: ["title", "tags", "productType", "vendor"],
        attributesToRetrieve: INSTANT_SEARCH_INDEX_FIELDS,
    };

    if (effectiveSort) {
        if (effectiveSort === 'price-ascending') {
            meiliSearchParams.sort = [`${marketPriceField || 'priceMin'}:asc`];
        } else if (effectiveSort === 'price-descending') {
            meiliSearchParams.sort = [`${marketPriceField || 'priceMin'}:desc`];
        } else if (effectiveSort === 'title-ascending') {
            meiliSearchParams.sort = ['title:asc'];
        } else if (effectiveSort === 'title-descending') {
            meiliSearchParams.sort = ['title:desc'];
        } else if (effectiveSort === 'created-ascending') {
            meiliSearchParams.sort = ['createdAt:asc'];
        } else if (effectiveSort === 'created-descending') {
            meiliSearchParams.sort = ['createdAt:desc'];
        }
    }

    // 2. Fetch Active Pinning Rule

    const rankingKey = `searchInstantRanking:${shop}:${createHash('sha256').update(JSON.stringify([
      cleanSearchQuery, meiliSearchParams, effectiveSort, limit, parsedQuery?.colorIntent,
      parsedQuery?.skuProductIds, url.searchParams.get('country') || '', url.searchParams.get('locale') || '',
      url.searchParams.get('customer_tags') || '',
    ])).digest('hex')}`;
    const ranking = !emptyPinnedIds.length && (pinningRule || merchandisingRule)
      ? await getCached(rankingKey, async () => rankSearchResults({
        shop, query: cleanSearchQuery, options: { ...meiliSearchParams, sortBy: effectiveSort },
        rule: merchandisingRule, pinningRule, parsedQuery, globalSettings, limit,
        mergedValues: await getCached(`mergedValues:${shop}`, () => prisma.mergedValue.findMany({ where: { shop, isActive: true } })),
      }), 60, { maxBytes: 2_000_000 }) : null;
    const directCacheKey = `searchInstant:${shop}:${createHash('sha256').update(JSON.stringify([
      cleanSearchQuery, meiliSearchParams,
    ])).digest('hex')}`;
    const meiliRes = ranking ? { hits: ranking.products, semanticHitCount: ranking.semanticHitCount }
      : await getCached(directCacheKey, () => semanticSearch(cleanSearchQuery, meiliSearchParams), 30);
    const rankingMs = Date.now() - startedAt - bootstrapMs;

    const didYouMean = spellingCorrection(cleanSearchQuery, meiliRes.hits, meiliRes.semanticHitCount);

    let suggestions = [];
    const configured = await Promise.race([
      configuredSuggestionPromise,
      new Promise(resolve => setTimeout(() => resolve([]), 500)),
    ]);
    const suggestionsMs = Date.now() - startedAt - bootstrapMs - rankingMs;
    if (searchQuery.length > 0 && suggestionLimit > 0 && configured === null) {
      try {
        const [tagFacets, typeFacets, colorFacets] = await Promise.all([
          meiliClient.index("products").searchForFacetValues({
             facetName: "tags",
             facetQuery: searchQuery,
             filter: [`shop = '${shop}'`]
          }),
          meiliClient.index("products").searchForFacetValues({
             facetName: "productType",
             facetQuery: searchQuery,
             filter: [`shop = '${shop}'`]
          }),
          meiliClient.index("products").searchForFacetValues({
             facetName: "option_Color",
             facetQuery: searchQuery,
             filter: [`shop = '${shop}'`]
          }).catch(() => ({ facetHits: [] })) // catch in case option_Color doesn't exist
        ]);

        // Combine and extract top 4 unique suggestions
        const combined = [
          ...(tagFacets.facetHits || []),
          ...(typeFacets.facetHits || []),
          ...(colorFacets.facetHits || [])
        ].sort((a, b) => b.count - a.count);

        const uniqueVals = new Set();
        combined.forEach(hit => {
           if (hit.value && hit.value.trim() !== "") {
              uniqueVals.add(hit.value);
           }
        });
        suggestions = Array.from(uniqueVals).slice(0, 4);
      } catch (e) {
        console.error("Facet search error:", e);
      }
    }

    // ✅ Map Meilisearch hits to match frontend expectations
    // Meili now contains handle, images, variantPrices — no extra Prisma query needed
    organicProducts = ranking ? [] : meiliRes.hits.map(h => ({
      ...h,
      id: `gid://shopify/Product/${h.id}`,
      // Normalize variantPrices → variants shape for frontend
      variants: (h.variantPrices || []).map(v => ({
        id: `gid://shopify/ProductVariant/${v.id}`,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        available: v.available,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        imageUrl: v.imageUrl,
      })),
    }));

    let pinnedIds = [];
    const mergedResults = ranking ? ranking.products : organicProducts;
    if (ranking) pinnedIds = mergedResults.filter(p => p.isPinned).map(p => p.id);
    if(emptyPinnedIds.length){
      const positions=new Map(emptyPinnedIds.map((id,index)=>[id,index]));
      mergedResults.sort((a,b)=>positions.get(String(a.id).split('/').pop())-positions.get(String(b.id).split('/').pop()));
      pinnedIds.push(...mergedResults.map(product=>product.id));
    }

    // ✅ No extra Prisma query for handles/images/variants — Meili has it all
    let activeResults = mergedResults
      .filter(p => {
        // Filter inactive: check Meili status field
        const status = (p.status || 'ACTIVE').toLowerCase();
        return status === 'active';
      })
      .map(p => {
        if (!parsedQuery?.colorIntent?.requested.length) return p;
        const variant = selectSearchColorVariant(p, parsedQuery.colorIntent.values, parsedQuery.colorIntent.requested);
        if (!variant || (globalSettings?.showOnlyInStock && variant.available === false)) return null;
        return { ...p, selectedVariantId: variant.id, searchColor: variant.searchColor,
          searchColorImage: variant.imageUrl, merchandisingImage: variant.imageUrl,
          images: variant.imageUrl ? [variant.imageUrl] : [],
          variants: (p.variants || []).map(v => String(v.id) === String(variant.id) ? { ...v, imageUrl: variant.imageUrl } : v) };
      })
      .filter(Boolean)
      .slice(0, limit)
      .map(p => ({ ...p, isPinned: pinnedIds.includes(p.id) }));

    let suggestionBlacklist = [];
    if (searchQuery) {
      try { suggestionBlacklist = await getActiveSuggestionBlacklist(shop); }
      catch (error) {
        console.error('Suggestion blacklist lookup failed:', error.name);
        // Keep products usable, but do not show unverified suggestions.
        suggestionBlacklist = null;
      }
    }
    suggestions = suggestionBlacklist === null || suggestionLimit === 0 ? [] : buildSearchSuggestions(searchQuery,configured===null?activeResults:[],configured===null?suggestions:configured,suggestionLimit,suggestionBlacklist);

    // Cards render before independently verified market prices arrive in the
    // storefront. Waiting for Shopify Admin pricing here delayed every card.
    const contextualPricingApplied = false;

    return data({
      query: query,
      totalCount: activeResults.length,
      matchCount: Math.max(activeResults.length, Number(ranking?.total ?? meiliRes.totalHits ?? meiliRes.estimatedTotalHits) || 0),
      queryIntent: intent ? { price: appliedIntent.price ? intent.price : null,
        size: appliedIntent.size ? intent.size : null,
        sortHint: effectiveSort === intent.sortHint ? intent.sortHint : null } : null,
      pinnedCount: activeResults.filter(p => p.isPinned).length,
      products: activeResults.map(p=>instantSearchCard(publicSearchProduct(p,searchContext.settings))),
      suggestions: suggestions,
      didYouMean: didYouMean,
      contextualPricingApplied: contextualPricingApplied,
      globalSettings: globalSettings
    }, {
      headers: {
        // Product cards retain their storefront session cache; suggestions
        // must reflect fresh blacklist settings on the next request.
        ...searchCacheHeaders(request),
        'X-CFP-Search-Ranking': ranking?.rankingMode || 'direct',
        'Server-Timing': `bootstrap;dur=${bootstrapMs}, ranking;dur=${rankingMs}, suggestions;dur=${suggestionsMs}, total;dur=${Math.max(0, Date.now() - startedAt)}`,
        'Timing-Allow-Origin': '*',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });

  } catch (error) {
    console.error("Error in api.search.jsx:", error);
    return data({ error: "Internal Server Error" }, {
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }
  return new Response("Method Not Allowed", { status: 405 });
};
