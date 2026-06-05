import { data } from "react-router";
import prisma from "../db.server";
import { getActivePinningRuleForSearch } from "../services/merchandising.server";

/**
 * API Endpoint: /api/search (Mapped to /apps/filter/search via App Proxy)
 * Method: GET
 * Purpose: Returns search results by merging local DB organic results and Pinned products.
 */
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  let query = url.searchParams.get("q");

  if (!shop) {
    return data({ error: "Missing shop parameter" }, { status: 400 });
  }

  try {
    let organicProducts = [];
    
    // 1. Fetch Organic Search Results from local synced database
    if (query && query.trim() !== "") {
      query = query.trim().toLowerCase();
      // Extremely basic search simulation matching title or tags. 
      // In a real production app, use Prisma Full-Text Search or dedicated indexing.
      organicProducts = await prisma.product.findMany({
        where: {
          shop: shop,
          status: { equals: "ACTIVE", mode: "insensitive" },
          OR: [
            { title: { contains: query, mode: "insensitive" } },
            { tags: { has: query } }
          ]
        },
        include: { variants: true },
        take: 50 // Limit organic results for now
      });
    }

    // 2. Fetch Active Pinning Rule
    const pinningRule = await getActivePinningRuleForSearch(shop, query || "");
    
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
          // Fetch full product details for pinned items from DB to get pricing/variants
          const dbPinnedProducts = await prisma.product.findMany({
            where: { 
              shop, 
              id: { in: pinnedIds },
              status: { equals: "ACTIVE", mode: "insensitive" }
            },
            include: { variants: true }
          });
          
          // Sort them according to the pinned order and set isPinned flag
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

    // Mark pinned items so the frontend can style them differently if needed
    const finalResults = mergedResults.map(p => ({
      ...p,
      isPinned: pinnedIds.includes(p.id)
    }));

    return data({
      query: query,
      totalCount: finalResults.length,
      pinnedCount: pinnedProducts.length,
      products: finalResults
    });

  } catch (error) {
    console.error("Error in api.search.jsx:", error);
    return data({ error: "Internal Server Error" }, { status: 500 });
  }
};
