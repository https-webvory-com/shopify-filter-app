import { data } from "react-router";
import prisma from "../db.server";
import meiliClient from "../services/meiliClient.server";

import { rateLimit } from "../services/rateLimiter.server";
import {getCached} from '../services/shopCache.server';
import {groupFacetValues} from '../utils/facetNormalization.js';

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
    // Frontend sends 'options.Color', meili expects 'option_Color'
    let meiliFacetName = facetName;
    if (facetName.startsWith("options.")) {
      meiliFacetName = "option_" + facetName.replace("options.", "");
    } else if (facetName.startsWith("metafields.")) {
      meiliFacetName = "metafield_" + facetName.replace("metafields.", "");
    } else if (facetName === "vendors") {
      meiliFacetName = "vendor";
    } else if (facetName === "productTypes") {
      meiliFacetName = "productType";
    }

    const searchResponse = await meiliIndex.searchForFacetValues({
      facetName: meiliFacetName,
      facetQuery: facetQuery,
      filter: filterString,
      maxFacetHits: 20
    });

    const type=({vendor:'vendor',productType:'product_type',tags:'tags',title:'title',collection_titles:'collection'})[meiliFacetName]||
      (meiliFacetName.startsWith('option_')?meiliFacetName.slice(7):meiliFacetName.startsWith('metafield_')?meiliFacetName.slice(10):meiliFacetName);
    const mergedValues=await getCached(`mergedValues:${shop}`,()=>prisma.mergedValue.findMany({where:{shop,isActive:true}}),30);
    const hits=(searchResponse.facetHits||[]).filter(hit=>typeof hit?.value==='string');
    const groups=groupFacetValues(type,hits.map(hit=>hit.value),mergedValues);
    // A facet-search window may omit another spelling of the same label.
    // Count each returned choice's product union in one bounded batch.
    const duplicateGroups=groups;
    const exact=new Map();
    if(duplicateGroups.length){
      const queries=duplicateGroups.map(group=>({indexUid:'products',q:'',filter:[...meiliFilter,`${meiliFacetName} IN ${JSON.stringify(group.rawValues)}`],hitsPerPage:1,page:1,attributesToRetrieve:[]}));
      const response=await getCached('facetSearchUnion:v1:'+shop+':'+JSON.stringify(queries),()=>meiliClient.multiSearch({queries}),30);
      duplicateGroups.forEach((group,index)=>{
        const count=response.results?.[index]?.totalHits;
        if(!Number.isSafeInteger(count)||count<0)throw Error('Exact facet count unavailable');
        exact.set(group.key,count);
      });
    }
    return data({
      facetHits: groups.map(group=>({value:group.value,rawValues:group.rawValues,count:exact.has(group.key)?exact.get(group.key):hits.find(hit=>hit.value===group.rawValues[0]).count}))
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
      }
    });

  } catch (error) {
    console.error("Facet API Error:", error);
    return data({ error: "Internal Server Error", message: error.message, stack: error.stack }, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};
