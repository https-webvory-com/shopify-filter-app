/**
 * CFP API Module V2
 * Handles all communication with the Remix backend.
 * Payload order matches V1 (collectionFilterPro.js) exactly.
 */

window.CFP_V2 = window.CFP_V2 || {};

window.CFP_V2.API = (function() {
  
  const getShopDomain = () => {
    return window.Shopify ? window.Shopify.shop : null;
  };

  /**
   * Builds the URL with params in the EXACT same order as V1:
   * shop → country → collectionHandle → isSearch → q →
   * minPrice → maxPrice → vendor[] → type[] → tags[] → collection[] →
   * options[X][] → metafields[X][] → sortBy → page → limit
   */
  const buildUrl = (endpoint, params = {}) => {
    const proxyBase = '/apps/collection-filter-pro/api';
    const url = new URL(`${window.location.origin}${proxyBase}/${endpoint}`);

    // 1. shop
    url.searchParams.append('shop', getShopDomain());

    // 2. country
    if (window.Shopify && window.Shopify.country) {
      url.searchParams.append('country', window.Shopify.country);
    }

    // 3. collectionHandle (collection pages only)
    const handle = params.handle || params.collectionHandle;
    if (handle) url.searchParams.append('collectionHandle', handle);

    // 4. isSearch + q (search page only)
    if (params.isSearch) url.searchParams.append('isSearch', 'true');
    if (params.q) url.searchParams.append('q', params.q);

    // 5. Price — only send if user changed from defaults
    if (params.priceMin !== undefined && params.priceMin !== null) {
      url.searchParams.append('minPrice', params.priceMin);
    }
    if (params.priceMax !== undefined && params.priceMax !== null) {
      url.searchParams.append('maxPrice', params.priceMax);
    }

    // 6. Basic filter arrays (V1 key names)
    (params.vendors || []).forEach(v => url.searchParams.append('vendor[]', v));
    (params.productTypes || []).forEach(t => url.searchParams.append('type[]', t));
    (params.tags || []).forEach(t => url.searchParams.append('tags[]', t));
    (params.collections || []).forEach(c => url.searchParams.append('collection[]', c));

    // 7. Dynamic options: options[Color][] = Red
    Object.entries(params.options || {}).forEach(([name, values]) => {
      (values || []).forEach(v => url.searchParams.append(`options[${name}][]`, v));
    });

    // 8. Dynamic metafields: metafields[key][] = value
    Object.entries(params.metafields || {}).forEach(([name, values]) => {
      (values || []).forEach(v => url.searchParams.append(`metafields[${name}][]`, v));
    });

    // 9. Sorting & Pagination
    url.searchParams.append('sortBy', params.sortBy || 'best-selling');
    url.searchParams.append('page', params.page || 1);
    url.searchParams.append('limit', params.limit || 28);

    return url.toString();
  };

  return {
    fetchCollectionData: async (collectionHandle, params = {}) => {
      try {
        const url = buildUrl('filter', { handle: collectionHandle, ...params });
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        return await response.json();
      } catch (error) {
        console.error('[CFP API] Error fetching collection data:', error);
        return null;
      }
    },

    fetchSearchData: async (params = {}) => {
      try {
        const url = buildUrl('filter', { isSearch: true, ...params });
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        return await response.json();
      } catch (error) {
        console.error('[CFP API] Error fetching search data:', error);
        return null;
      }
    }
  };
})();
