import { data } from "react-router";
import prisma from "../db.server";
import { getActivePinningRuleForSearch } from "../services/merchandising.server";
import meiliClient from "../services/meiliClient.server";


/**
 * API Endpoint: /api/search (Mapped to /apps/filter/search via App Proxy)
 * Method: GET
 * Purpose: Returns fast search results using Meilisearch, merging Pinned products.
 */
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  let query = url.searchParams.get("q") || "";
  const limit = parseInt(url.searchParams.get("limit") || "10", 10);
  const sortBy = url.searchParams.get("sortBy");

  if (!shop) {
    return data({ error: "Missing shop parameter" }, { status: 400 });
  }

  try {
    let organicProducts = [];
    
    const searchQuery = query ? query.trim() : "";
    
    // -- TIER 1: NLP Intent Extraction (DISABLED) --
    // const aiExtracted = await extractFiltersFromQuery(searchQuery);
    const aiExtracted = { clean_query: searchQuery, min_price: null, max_price: null, attributes: {} };
    const cleanSearchQuery = typeof aiExtracted.clean_query === 'string' ? aiExtracted.clean_query : searchQuery;
    
    let meiliFilters = [`shop = '${shop}'`];
    
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
        // hybrid: {
        //     semanticRatio: 0.1,
        //     embedder: "default"
        // }
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

    let meiliRes;
    try {
        // -- TIER 2: Hybrid Semantic Vector Search --
        meiliRes = await meiliClient.index("products").search(cleanSearchQuery, meiliSearchParams);
    } catch (vectorError) {
        // GRACEFUL FALLBACK: If API Key expires or Meilisearch is not configured for vectors
        console.error("CFP: Semantic Search failed, falling back to Keyword Search. Error:", vectorError.message);
        delete meiliSearchParams.hybrid;
        meiliRes = await meiliClient.index("products").search(searchQuery, meiliSearchParams);
    }

    let didYouMean = null;
    if (cleanSearchQuery.length > 2 && meiliRes.hits.length > 0) {
      const sq = cleanSearchQuery.toLowerCase();
      // Check if clean query is found exactly in any of the results
      const exactMatchFound = meiliRes.hits.some(hit => 
        (hit.title && hit.title.toLowerCase().includes(sq)) ||
        (hit.tags && hit.tags.some(t => t.toLowerCase().includes(sq))) ||
        (hit.vendor && hit.vendor.toLowerCase().includes(sq)) ||
        (hit.productType && hit.productType.toLowerCase().includes(sq))
      );

      if (!exactMatchFound) {
        // Typo tolerance kicked in. Let's extract the highlighted word.
        const firstHit = meiliRes.hits[0];
        if (firstHit._formatted) {
          const formattedStr = JSON.stringify(firstHit._formatted);
          const match = formattedStr.match(/<em>(.*?)<\/em>/i);
          if (match && match[1]) {
             // Only suggest if it's purely letters and not exactly what they typed
             const suggestion = match[1].toLowerCase().trim();
             if (suggestion !== sq && /^[a-z0-9\s]+$/.test(suggestion)) {
                didYouMean = suggestion;
             }
          }
        }
      }
    }

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
    organicProducts = meiliRes.hits.map(h => ({
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

    // 2. Fetch Active Pinning Rule
    const pinningRule = await getActivePinningRuleForSearch(shop, query);
    
    // 3. Merge Pinned Products and Organic Products
    let pinnedIds = [];
    let pinnedProducts = [];

    if (pinningRule && pinningRule.products) {
      try {
        const parsedPins = typeof pinningRule.products === "string" 
          ? JSON.parse(pinningRule.products) 
          : pinningRule.products;
          
        if (Array.isArray(parsedPins)) {
          pinnedIds = parsedPins.map(p => p.id);
          
          // For pinned products, fetch from Prisma (they may not be in Meili results)
          const dbPinnedProducts = await prisma.product.findMany({
            where: { 
              shop, 
              id: { in: pinnedIds },
              status: { equals: "ACTIVE", mode: "insensitive" }
            },
            include: { variants: true }
          });
          
          pinnedProducts = pinnedIds.map(id => {
            const p = dbPinnedProducts.find(prod => prod.id === id);
            if (p) {
              p.isPinned = true;
              return p;
            }
            return null;
          }).filter(Boolean);
        }
      } catch (e) {
        console.error("Error parsing pinned products in api.search:", e);
      }
    }

    // Remove any organic products that are already in the pinned list to avoid duplicates
    const filteredOrganicProducts = organicProducts.filter(p => !pinnedIds.includes(p.id));

    // Combine them (Pinned items first)
    const mergedResults = [...pinnedProducts, ...filteredOrganicProducts];

    // ✅ No extra Prisma query for handles/images/variants — Meili has it all
    let activeResults = mergedResults
      .filter(p => {
        // Filter inactive: check Meili status field
        const status = (p.status || 'ACTIVE').toLowerCase();
        return status === 'active';
      })
      .slice(0, limit)
      .map(p => ({ ...p, isPinned: pinnedIds.includes(p.id) }));

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
      pinnedCount: pinnedProducts.length,
      products: activeResults,
      suggestions: suggestions,
      didYouMean: didYouMean,
      contextualPricingApplied: contextualPricingApplied
    });

  } catch (error) {
    console.error("Error in api.search.jsx:", error);
    return data({ error: "Internal Server Error" }, { status: 500 });
  }
};
