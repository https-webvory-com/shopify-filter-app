import meiliClient from "./meiliClient.server.js";

import { getCached } from "./shopCache.server.js";
import prisma from "../db.server";
import { resolveSearchColor, colorSearchFilter } from "../utils/searchColor.js";

export async function initializeParserCache(shop) {
  if (!shop) throw new Error("Query parser requires a shop");
  return getCached(`queryParserFacets:${shop}`, async () => {
    const index = meiliClient.index('products');
    const attributes = await index.getFilterableAttributes();
    const colorFields = attributes.filter(field => typeof field === 'string' && /^option_colou?r$/i.test(field));
    const search = await index.search('', {
      limit: 0, facets: [...colorFields, 'vendor', 'productType'],
      filter: [`shop = ${JSON.stringify(shop)}`, "status = 'ACTIVE'"]
    });
    const dist = search.facetDistribution || {};
    return {
      colors: [...new Set(colorFields.flatMap(field => Object.keys(dist[field] || {})))],
      colorFields, vendors: Object.keys(dist.vendor || {}), productTypes: Object.keys(dist.productType || {})
    };
  });
}

export async function parseQuery(query, shop) {
  if (!query || typeof query !== 'string') return null;

  const cache = await initializeParserCache(shop);
  const lowerQuery = query.toLowerCase().trim();
  const tokens = lowerQuery.split(/\s+/);
  
  let detectedColors = [];
  let detectedVendors = [];
  let detectedTypes = [];

  const aliases = await getCached(`mergedValues:${shop}`, () => prisma.mergedValue.findMany({ where: { shop, isActive: true } }));
  const colorIntent = resolveSearchColor(query, cache.colors, aliases);
  const queryColorWords = colorIntent.requested;
  detectedColors = colorIntent.values;

  // Detect vendors
  for (const v of cache.vendors) {
    if (v.trim() === '') continue;
    const vLower = v.toLowerCase();
    // Use word boundaries so "Mac" doesn't match "Machine"
    const regex = new RegExp(`(^|[^a-z])${escapeRegExp(vLower)}([^a-z]|$)`);
    if (regex.test(lowerQuery)) {
      detectedVendors.push(v);
    }
  }

  // Detect types
  for (const t of cache.productTypes) {
    if (t.trim() === '') continue;
    const tLower = t.toLowerCase();
    const regex = new RegExp(`(^|[^a-z])${escapeRegExp(tLower)}([^a-z]|$)`);
    if (regex.test(lowerQuery)) {
      detectedTypes.push(t);
    }
  }

  let remainingQuery = lowerQuery;

  if (queryColorWords.length === 1) {
    for (const cw of queryColorWords) {
      remainingQuery = remainingQuery.replace(new RegExp(`(^|\\s)${cw}(\\s|$)`, 'ig'), ' ').trim();
    }
  }

  if (detectedVendors.length > 0) {
    for (const v of detectedVendors) {
      remainingQuery = remainingQuery.replace(new RegExp(`(^|\\s)${escapeRegExp(v)}(\\s|$)`, 'ig'), ' ').trim();
    }
  }

  if (detectedTypes.length > 0) {
    for (const t of detectedTypes) {
      remainingQuery = remainingQuery.replace(new RegExp(`(^|\\s)${escapeRegExp(t)}(\\s|$)`, 'ig'), ' ').trim();
    }
  }

  // Clean up any double spaces left behind
  remainingQuery = remainingQuery.replace(/\s+/g, ' ').trim();

  return {
    originalQuery: query,
    remainingQuery,
    hasFilters: detectedColors.length > 0 || detectedVendors.length > 0 || detectedTypes.length > 0 || queryColorWords.length > 0,
    filters: {
      colors: detectedColors,
      vendors: detectedVendors,
      types: detectedTypes
    },
    queryColorWords,
    colorIntent,
    colorFilter: colorSearchFilter(colorIntent, cache.colorFields)
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
