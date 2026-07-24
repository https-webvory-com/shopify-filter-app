import { data } from "react-router";
import prisma from "../db.server";
import meiliClient from "../services/meiliClient.server";

import { rateLimit } from "../services/rateLimiter.server";

export const loader = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const facetName = url.searchParams.get("facetName");
    const facetQuery = url.searchParams.get("facetQuery");

    if (!shop || !facetName || !facetQuery) {
      return data({ error: "Missing required parameters" }, { status: 400 });
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

    const collectionHandle = url.searchParams.get("collectionHandle");
    const collectionId = url.searchParams.get("collectionId");
    
    // We only resolve collection ID if provided, to scope the facet search.
    let resolvedCollectionId = collectionId;
    if (collectionHandle && collectionHandle.toLowerCase() !== "all") {
      const coll = await prisma.collection.findFirst({
        where: { handle: collectionHandle, shop },
        select: { id: true },
      });
      if (coll) {
        resolvedCollectionId = coll.id;
      }
    }

    if (resolvedCollectionId && !resolvedCollectionId.includes("gid://")) {
        resolvedCollectionId = `gid://shopify/Collection/${resolvedCollectionId}`;
    }

    // Build meili filters similar to api.filter.jsx
    let meiliFilter = [`shop = "${shop}"`, `status = "ACTIVE"`];

    if (resolvedCollectionId) {
      meiliFilter.push(`collections = "${resolvedCollectionId}"`);
    }

    // We can apply existing filters if we want the facet search scoped exactly to the current results.
    // For now, based on user preference "Option A", we scope it to the collection, but we won't scope it
    // to OTHER selected facets, so they can find facets even if they selected a different color.

    const filterString = meiliFilter.map((f) => `(${f})`).join(" AND ");

    const meiliIndex = meiliClient.index("products");
    
    // Check if the facetName is one of the filterable attributes in Meilisearch
    // Usually it's like 'options.Color' or 'tags' or 'vendor'
    const searchResponse = await meiliIndex.searchForFacetValues({
      facetName: facetName,
      facetQuery: facetQuery,
      filter: filterString,
      maxFacetHits: 20
    });

    return data({
      facetHits: searchResponse.facetHits
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error) {
    console.error("Facet API Error:", error);
    return data({ error: "Internal Server Error" }, { status: 500 });
  }
};
