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

  if (!shop) {
    return data({ error: "Missing shop parameter" }, { status: 400 });
  }

  try {
    let organicProducts = [];
    
    // 1. Fetch Organic Search Results from Meilisearch
    // If query is empty, Meilisearch returns all documents (up to limit) which acts as a default/trending view.
    const searchQuery = query ? query.trim() : "";
    const meiliRes = await meiliClient.index("products").search(searchQuery, {
      filter: [`shop = '${shop}'`, `available = true`],
      limit: limit,
      facets: ["tags", "productType"],
      attributesToHighlight: ["title", "tags", "productType", "vendor"]
    });

    let didYouMean = null;
    if (searchQuery.length > 2 && meiliRes.hits.length > 0) {
      const sq = searchQuery.toLowerCase();
      // Check if original query is found exactly in any of the results
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
             filter: [`shop = '${shop}'`, `available = true`]
          }),
          meiliClient.index("products").searchForFacetValues({
             facetName: "productType",
             facetQuery: searchQuery,
             filter: [`shop = '${shop}'`, `available = true`]
          }),
          meiliClient.index("products").searchForFacetValues({
             facetName: "option_Color",
             facetQuery: searchQuery,
             filter: [`shop = '${shop}'`, `available = true`]
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
    
    // Map Meilisearch hits to match frontend expectations
    organicProducts = meiliRes.hits.map(h => ({
      ...h,
      id: `gid://shopify/Product/${h.id}`,
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
          
          // For pinned products, we fetch from Prisma to ensure we have all details
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

    // Truncate to limit if needed (in case pinning made it exceed the requested limit)
    // Actually, usually we just return the requested limit exactly.
    const finalResults = mergedResults.slice(0, limit).map(p => ({
      ...p,
      isPinned: pinnedIds.includes(p.id)
    }));

    // If organic results from Meilisearch didn't include full variant details that instantSearch.js needs,
    // we can fetch the missing Prisma data here, or just rely on Meilisearch's indexed fields.
    // Since Meilisearch has priceMin, title, handle, image, it's usually enough for Instant Search.
    
    // To ensure price ranges work perfectly, we will quickly fetch the minimal variant info for the final results
    const finalIds = finalResults.map(p => p.id);
    const dbFinalProducts = await prisma.product.findMany({
      where: { id: { in: finalIds } },
      select: { 
        id: true, 
        handle: true,
        images: true,
        options: true,
        variants: { 
          select: { 
            id: true,
            price: true, 
            compareAtPrice: true,
            option1: true,
            option2: true,
            option3: true,
            imageUrl: true
          } 
        } 
      }
    });

    finalResults.forEach(p => {
      const dbp = dbFinalProducts.find(db => db.id === p.id);
      if (dbp) {
        if (dbp.variants) p.variants = dbp.variants;
        if (dbp.handle) p.handle = dbp.handle;
        if (dbp.images) p.images = dbp.images;
        if (dbp.options) p.options = dbp.options;
      }
    });

    return data({
      query: query,
      totalCount: finalResults.length,
      pinnedCount: pinnedProducts.length,
      products: finalResults,
      suggestions: suggestions,
      didYouMean: didYouMean
    });

  } catch (error) {
    console.error("Error in api.search.jsx:", error);
    return data({ error: "Internal Server Error" }, { status: 500 });
  }
};
