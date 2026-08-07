import meiliClient from "./meiliClient.server.js";

let facetCache = {
  colors: [],
  vendors: [],
  productTypes: [],
  lastUpdated: null
};

// Cache expires after 1 hour
const CACHE_TTL = 60 * 60 * 1000;

export async function initializeParserCache() {
  try {
    const now = Date.now();
    if (facetCache.lastUpdated && (now - facetCache.lastUpdated) < CACHE_TTL) {
      return facetCache;
    }

    console.log("[QueryParser] Fetching facets to build query parsing dictionary...");
    const index = meiliClient.index('products');
    
    // We fetch global facets (no query) to build our lists
    const search = await index.search('', {
      limit: 0,
      facets: ['option_Color', 'vendor', 'productType']
    });

    const dist = search.facetDistribution || {};
    
    facetCache.colors = Object.keys(dist.option_Color || {});
    facetCache.vendors = Object.keys(dist.vendor || {});
    facetCache.productTypes = Object.keys(dist.productType || {});
    facetCache.lastUpdated = now;

    console.log(`[QueryParser] Dictionary built: ${facetCache.colors.length} colors, ${facetCache.vendors.length} vendors, ${facetCache.productTypes.length} types`);
    
    return facetCache;
  } catch (error) {
    console.error("[QueryParser] Failed to initialize cache:", error);
    return facetCache;
  }
}

export async function parseQuery(query) {
  if (!query || typeof query !== 'string') return null;

  const cache = await initializeParserCache();
  const lowerQuery = query.toLowerCase().trim();
  const tokens = lowerQuery.split(/\s+/);
  
  let detectedColors = [];
  let detectedVendors = [];
  let detectedTypes = [];

  // Basic known generic colors to identify color intents from queries
  const basicColorTerms = [
    "black", "white", "red", "blue", "green", "yellow", "orange", 
    "pink", "purple", "brown", "grey", "gray", "royal", "navy", 
    "burgundy", "gold", "silver", "fuchsia", "teal", "champagne", 
    "ivory", "blush", "rose", "emerald", "aqua", "coral", "lilac",
    "magenta", "maroon", "peach", "plum", "sage", "sapphire", "taupe"
  ];
  
  const queryColorWords = tokens.filter(t => basicColorTerms.includes(t));
  
  if (queryColorWords.length > 0) {
    // Find all exact option_Color values that contain ANY of the detected color words
    // For example, if words are ["royal", "black"], this matches "Royal/Black", "Royal Blue", "Black", etc.
    detectedColors = cache.colors.filter(c => {
      const cLower = c.toLowerCase();
      // Only match if the exact string contains ANY color words
      return queryColorWords.some(cw => {
        // Enforce word boundaries roughly so "red" doesn't match "textured"
        const regex = new RegExp(`(^|[^a-z])${cw}([^a-z]|$)`);
        return regex.test(cLower);
      });
    });
  }

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

  if (queryColorWords.length > 0) {
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
    hasFilters: detectedColors.length > 0 || detectedVendors.length > 0 || detectedTypes.length > 0,
    filters: {
      colors: detectedColors,
      vendors: detectedVendors,
      types: detectedTypes
    },
    queryColorWords
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
