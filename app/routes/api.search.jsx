import {getMarketAvailableProductIds} from '../services/marketAvailability.server.js';
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
/**
 * API Endpoint: /api/search (Mapped to /apps/filter/search via App Proxy)
 * Method: GET
 * Purpose: Returns fast search results using Meilisearch, merging Pinned products.
 */
export const loader = async ({ request }) => {
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
    const globalSettings = await getCached(`globalSettings:${shop}`, () => getFilterGlobalSettings(shop));
    let organicProducts = [];

    const searchQuery = query ? query.trim() : "";

    const parsedQuery = searchQuery ? await parseQuery(searchQuery, shop) : null;

    // -- TIER 1: NLP Intent Extraction (DISABLED) --
    // const aiExtracted = await extractFiltersFromQuery(searchQuery);
    const aiExtracted = { clean_query: searchQuery, min_price: null, max_price: null, attributes: {} };
    const cleanSearchQuery = typeof aiExtracted.clean_query === 'string' ? aiExtracted.clean_query : searchQuery;

    let meiliFilters = [`shop = '${shop.replace(/'/g, "\\'")}'`, "status = 'ACTIVE'"];

    if (parsedQuery?.colorFilter) meiliFilters.push(parsedQuery.colorFilter);

    let marketAvailableIds=null;
    if (globalSettings?.showOnlyInStock) {
      meiliFilters.push(`available = true`);
      marketAvailableIds=await getMarketAvailableProductIds(shop,url.searchParams.get('country'));
      if(marketAvailableIds===null)return data({products:[],marketAvailabilityPending:true},{status:202,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Retry-After':'1'}});
      if(Array.isArray(marketAvailableIds))meiliFilters.push(marketAvailableIds.length?'id IN '+JSON.stringify(marketAvailableIds):'id = "__no_market_available_products__"');
    }

    if (aiExtracted.min_price !== undefined && aiExtracted.min_price !== null) {
        meiliFilters.push(`priceMin >= ${aiExtracted.min_price}`);
    }
    if (aiExtracted.max_price !== undefined && aiExtracted.max_price !== null) {
        meiliFilters.push(`priceMin <= ${aiExtracted.max_price}`);
    }

    // Dynamically apply any extra attributes (size, color, material etc)
    if (aiExtracted.attributes && typeof aiExtracted.attributes === 'object') {
        for (const [key, value] of Object.entries(aiExtracted.attributes)) {
            if (!value) continue;
            // Map keys like "size" to Meilisearch attribute "option_Size" (capitalized)
            const facetName = `option_${key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()}`;
            // Add to meilisearch filter with case-insensitive match assumption
            meiliFilters.push(`${facetName} = '${value}'`);
        }
    }

    let meiliSearchParams = {
        filter: meiliFilters,
        limit: limit + 20, // Request extra to compensate for post-filtering
        facets: ["tags", "productType"],
        attributesToHighlight: ["title", "tags", "productType", "vendor"]
    };

    if (sortBy) {
        if (sortBy === 'price-ascending') {
            meiliSearchParams.sort = ['priceMin:asc'];
        } else if (sortBy === 'price-descending') {
            meiliSearchParams.sort = ['priceMin:desc'];
        } else if (sortBy === 'title-ascending') {
            meiliSearchParams.sort = ['title:asc'];
        } else if (sortBy === 'title-descending') {
            meiliSearchParams.sort = ['title:desc'];
        } else if (sortBy === 'created-ascending') {
            meiliSearchParams.sort = ['createdAt:asc'];
        } else if (sortBy === 'created-descending') {
            meiliSearchParams.sort = ['createdAt:desc'];
        }
    }

    // 2. Fetch Active Pinning Rule
    const [pinningRule, merchandisingRule] = await Promise.all([
      getActivePinningRuleForSearch(shop, query, "instant"),
      getActiveRuleForSearch(shop, query, (url.searchParams.get('customer_tags') || '').split(',').map(t => t.trim()).filter(Boolean), url.searchParams.get('locale') || ''),
    ]);

    const ranking = pinningRule || merchandisingRule ? await rankSearchResults({
      shop, query: cleanSearchQuery, options: { ...meiliSearchParams, sortBy },
      rule: merchandisingRule, pinningRule, parsedQuery, globalSettings, marketAvailableIds, limit,
      mergedValues: await getCached(`mergedValues:${shop}`, () => prisma.mergedValue.findMany({ where: { shop, isActive: true } })),
    }) : null;
    const meiliRes = ranking ? { hits: ranking.products, semanticHitCount: ranking.semanticHitCount }
      : await semanticSearch(cleanSearchQuery, meiliSearchParams);

    const didYouMean = spellingCorrection(cleanSearchQuery, meiliRes.hits, meiliRes.semanticHitCount);

    let suggestions = [];
    if (searchQuery.length > 0) {
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
    const rawSuggestionLimit = url.searchParams.get('suggestionLimit');
    const suggestionLimit = rawSuggestionLimit !== null && /^\d+$/.test(rawSuggestionLimit) ? Math.min(10, Number(rawSuggestionLimit)) : 6;
    suggestions = suggestionBlacklist === null || suggestionLimit === 0 ? [] : buildSearchSuggestions(searchQuery, activeResults, suggestions, suggestionLimit, suggestionBlacklist);

    // Contextual Pricing
    let contextualPricingApplied = false;
    const country = url.searchParams.get("country");
    if (country && activeResults.length > 0) {
      try {
        const { unauthenticated } = await import("../shopify.server");
        const { admin } = await unauthenticated.admin(shop);
        if (admin) {
           const productGids = activeResults.map(p => p.id);
           const query = `
             query getPrices($ids: [ID!]!, $country: CountryCode!) {
               nodes(ids: $ids) {
                 ... on Product {
                   id
                   variants(first: 100) {
                     nodes {
                       id
                       contextualPricing(context: {country: $country}) {
                         price { amount }
                         compareAtPrice { amount }
                       }
                     }
                   }
                 }
               }
             }
           `;
           const response = await admin.graphql(query, { variables: { ids: productGids, country } });
           const json = await response.json();
           if (json.data && json.data.nodes) {
              json.data.nodes.forEach(node => {
                 if (!node) return;
                 const product = activeResults.find(p => p.id === node.id);
                 if (product) {
                    let minPrice = Infinity;
                    let maxPrice = -Infinity;
                    if (node.variants && node.variants.nodes) {
                        node.variants.nodes.forEach(vNode => {
                           const v = (product.variants || []).find(pv => pv.id === vNode.id);
                           if (v && vNode.contextualPricing) {
                              const amt = parseFloat(vNode.contextualPricing.price.amount);
                              v.price = amt;
                              if (vNode.contextualPricing.compareAtPrice) {
                                 v.compareAtPrice = parseFloat(vNode.contextualPricing.compareAtPrice.amount);
                              }
                              if (amt < minPrice) minPrice = amt;
                              if (amt > maxPrice) maxPrice = amt;
                           }
                        });
                    }
                    if (minPrice !== Infinity) {
                       product.priceMin = minPrice;
                    }
                    if (maxPrice !== -Infinity) {
                       product.priceMax = maxPrice;
                    }
                 }
              });
              contextualPricingApplied = true;
           }
        }
      } catch (e) {
         console.error("Contextual pricing error in search:", e);
      }
    }

    return data({
      query: query,
      totalCount: activeResults.length,
      pinnedCount: activeResults.filter(p => p.isPinned).length,
      products: activeResults,
      suggestions: suggestions,
      didYouMean: didYouMean,
      contextualPricingApplied: contextualPricingApplied,
      globalSettings: globalSettings
    }, {
      headers: {
        // Product cards retain their storefront session cache; suggestions
        // must reflect fresh blacklist settings on the next request.
        'Cache-Control': 'no-store',
        'X-CFP-Search-Ranking': ranking?.rankingMode || 'direct',
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
