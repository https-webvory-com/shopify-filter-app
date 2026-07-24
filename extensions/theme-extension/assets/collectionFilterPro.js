/**
 * Collection Filter Pro â€” Storefront JavaScript
 * Dynamic UI Injection and Relative App Proxy Querying
 */ 

var API_DOMAIN = 'https://aisearchfilter.webvory.com'; // TODO: Change this to your deployed AWS API domain

(function () {
  'use strict';
  const customSettings = window.collectionFilterProSettings || {};
 
  let sidebar = null;
  let topBar = null;
  let overlay = null;
  let triggerBtn = null;
  let closeBtn = null;
  let applyBtn = null;
  let clearBtn = null;
  let activeCount = null;

  function queryElements() {
    sidebar = document.getElementById('cfp-sidebar');
    topBar = document.getElementById('cfp-top-bar');
    overlay = document.getElementById('cfp-overlay');
    triggerBtn = document.getElementById('cfp-drawer-trigger-btn');
    closeBtn = document.getElementById('cfp-close-btn');
    applyBtn = document.getElementById('cfp-apply-btn');
    clearBtn = document.getElementById('cfp-clear-btn');
    activeCount = document.getElementById('cfp-active-count');
  }

  function ensureSidebarReady() {
    queryElements();
    return Boolean(sidebar);
  }

  let shop = '';
  let collectionId = '';
  let collectionHandle = '';
  let templateName = '';
  let searchTerms = '';

  function initDataVariables() {
    if (sidebar) {
      shop = sidebar.dataset.shop || '';
      collectionId = sidebar.dataset.collectionId || '';
      collectionHandle = sidebar.dataset.collectionHandle || '';
      templateName = sidebar.dataset.templateName || '';
      searchTerms = sidebar.dataset.searchTerms || '';
    }
  }

  function getGlobalCurrencyRate() {
    if (window.Shopify && window.Shopify.currency && window.Shopify.currency.rate) {
      return parseFloat(window.Shopify.currency.rate) || 1;
    }
    return 1;
  }

  function getGlobalCurrencySymbol() {
    if (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) {
      try {
        const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: window.Shopify.currency.active }).formatToParts(0);
        const sym = parts.find(p => p.type === 'currency');
        if (sym) return sym.value;
      } catch(e) {}
    }
    return (window.cfpCurrency && window.cfpCurrency.symbol) ? window.cfpCurrency.symbol : '$';
  }

  // Production build - debug logs removed

  // â”€â”€ 1. Global Filter State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const PAGE_SIZE = 28;

  let activeFilters = {
    vendors: [],
    types: [],
    tags: [],
    titles: [],
    collections: [],
    options: {}, // name -> array of values
    metafields: {}, // key -> array of values
    availability: [], // 'in_stock', 'out_of_stock'
    priceRanges: [], // selected price range strings
    minPrice: 0,
    maxPrice: 999999,
    sortBy: 'best-selling',
    page: 1
  };

  let maxPriceLimit = 1000;

  // URL state synchronization setup
  function parseURLState() {
    const urlParams = new URLSearchParams(window.location.search);
    
    if (urlParams.has('q')) activeFilters.q = urlParams.get('q');
    else if (searchTerms) activeFilters.q = searchTerms;

    if (urlParams.has('page')) activeFilters.page = parseInt(urlParams.get('page')) || 1;
    if (urlParams.has('sortBy')) activeFilters.sortBy = urlParams.get('sortBy');
    if (urlParams.has('minPrice')) activeFilters.minPrice = parseInt(urlParams.get('minPrice')) || 0;
    if (urlParams.has('maxPrice')) activeFilters.maxPrice = parseInt(urlParams.get('maxPrice')) || 999999;
    
    ['vendors', 'types', 'tags', 'collections'].forEach(key => {
      if (urlParams.has(key) && urlParams.get(key)) {
        activeFilters[key] = urlParams.get(key).split(',');
      }
    });
    
    for (const [key, value] of urlParams.entries()) {
      if (key.startsWith('option_') && value) {
        const opt = key.replace('option_', '');
        activeFilters.options[opt] = value.split(',');
      } else if (key.startsWith('metafield_') && value) {
        const meta = key.replace('metafield_', '');
        activeFilters.metafields[meta] = value.split(',');
      }
    }
  }

  function syncStateToURL() {
    const params = new URLSearchParams(window.location.search);
    
    if (activeFilters.q) params.set('q', activeFilters.q);
    else params.delete('q');

    if (activeFilters.page > 1) params.set('page', activeFilters.page);
    else params.delete('page');

    if (activeFilters.sortBy && activeFilters.sortBy !== 'best-selling') params.set('sortBy', activeFilters.sortBy);
    else params.delete('sortBy');

    if (activeFilters.minPrice > 0) params.set('minPrice', activeFilters.minPrice);
    else params.delete('minPrice');

    if (activeFilters.maxPrice < 999999) params.set('maxPrice', activeFilters.maxPrice);
    else params.delete('maxPrice');

    ['vendors', 'types', 'tags', 'collections'].forEach(key => {
      if (activeFilters[key] && activeFilters[key].length > 0) params.set(key, activeFilters[key].join(','));
      else params.delete(key);
    });

    for (let key of Array.from(params.keys())) {
      if (key.startsWith('option_') || key.startsWith('metafield_')) params.delete(key);
    }
    
    Object.keys(activeFilters.options || {}).forEach(opt => {
      if (activeFilters.options[opt].length > 0) params.set('option_' + opt, activeFilters.options[opt].join(','));
    });
    
    Object.keys(activeFilters.metafields || {}).forEach(meta => {
      if (activeFilters.metafields[meta].length > 0) params.set('metafield_' + meta, activeFilters.metafields[meta].join(','));
    });

    const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState(null, '', newUrl);
  }

  parseURLState(); // Call immediately to populate activeFilters

  let globalSettings = {}; // Updated dynamically from product prices
  let cfpLastSettings = [];
  let cfpLastFacets = {};
  let cfpLastTotalCount = 0;
  let cfpGroupToggleState = {};
  let cfpGroupScrollState = {};

    const getCleanLabel = (type, val) => {
      if (!cfpLastSettings || cfpLastSettings.length === 0) return { label: type.charAt(0).toUpperCase() + type.slice(1), cleanVal: val };
      
      let group = null;
      if (type === 'tag') {
        group = cfpLastSettings.find(s => (s.filterType === 'tag' || s.filterType === 'tags') && s.config && s.config.prefix && val.toLowerCase().startsWith(s.config.prefix.toLowerCase()));
        if (group) {
          return {
            label: group.label || 'Tag',
            cleanVal: val.slice(group.config.prefix.length)
          };
        }
      } else if (type.startsWith('option-')) {
        const key = type.replace('option-', '');
        group = cfpLastSettings.find(s => (s.filterType === 'option' || s.type === 'option') && (s.filterKey === key || s.key === key));
        if (group && group.config && group.config.prefix && val.toLowerCase().startsWith(group.config.prefix.toLowerCase())) {
          return {
            label: group.label || key,
            cleanVal: val.slice(group.config.prefix.length)
          };
        }
      } else if (type.startsWith('metafield-')) {
        const key = type.replace('metafield-', '');
        group = cfpLastSettings.find(s => (s.filterType === 'metafield' || s.type === 'metafield') && (s.filterKey === key || s.key === key));
        if (group && group.config && group.config.prefix && val.toLowerCase().startsWith(group.config.prefix.toLowerCase())) {
          return {
            label: group.label || key,
            cleanVal: val.slice(group.config.prefix.length)
          };
        }
      }
      return { label: type.charAt(0).toUpperCase() + type.slice(1), cleanVal: val };
    };


  // â”€â”€ 2. Initialization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let activeMerchandisingRule = null;

    async function init() {
    if (!ensureSidebarReady()) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
        return;
      }
      console.warn('[CFP] Sidebar not found, aborting initialization');
      return;
    }
    
    initDataVariables();
    parseURLState();
    
    // Make sure we inject the UI into the correct container now that sidebar is ready
    findAndInject();

    if (triggerBtn) {
      triggerBtn.addEventListener('click', openSidebar);
    }

    setupStaticEventListeners();
    renderSkeleton();
    await fetchMerchandisingRule();
    await fetchAndRenderData();
  }

  // â”€â”€ 2.5 Fetch Merchandising Rule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function fetchMerchandisingRule() {
    // try {
    //   const queryParams = new URLSearchParams();
    //   queryParams.append('shop', shop);
    //   if (window.cfpCustomerTags) {
    //     queryParams.append('customer_tags', window.cfpCustomerTags);
    //   }
    //   if (collectionHandle) {
    //     queryParams.append('collectionHandle', collectionHandle);
    //   } else if (collectionId) {
    //     queryParams.append('collectionId', collectionId);
    //   }
    //   const response = await fetch(`/apps/collection-filter-pro/api/merchandising?${queryParams.toString()}`);
    //   const data = await response.json();
    //   if (data && data.rule) {
    //     activeMerchandisingRule = data.rule;
    //   }
    // } catch (e) {
    //   console.error("CFP: Merchandising API error", e);
    // }
  }

  // â”€â”€ 3. Fetch data from Shopify App Proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  
  async function fetchAndRenderData(isLoadMore = false) {
      syncStateToURL(); // Sync URL

    if (window._cfpInitialized && globalSettings && globalSettings.scrollUpOnFilterValuesChange && !globalSettings.horizontalFilters) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    try {
      const queryParams = new URLSearchParams();

      // Guard: shop must be present
      if (!shop) {
        console.error('CFP: Missing shop domain — cannot fetch filter data.');
        return;
      }
      queryParams.append('shop', shop);
      
      if (window.Shopify && window.Shopify.country) {
         queryParams.append('country', window.Shopify.country);
      }
      
      if (window.cfpCustomerTags) {
        queryParams.append('customer_tags', window.cfpCustomerTags);
      }

      if (collectionHandle) {
        queryParams.append('collectionHandle', collectionHandle);
      } else if (collectionId) {
        queryParams.append('collectionId', collectionId);
      }
      
      if (templateName === 'search') {
        queryParams.append('isSearch', 'true');
        if (searchTerms) {
          queryParams.append('q', searchTerms);
        }
      }

      // Price range
      if (activeFilters.minPrice > 0) queryParams.append('minPrice', activeFilters.minPrice);
      if (activeFilters.maxPrice < maxPriceLimit) queryParams.append('maxPrice', activeFilters.maxPrice);

      // Basic arrays
      activeFilters.vendors.forEach(v => queryParams.append('vendor[]', v));
      activeFilters.types.forEach(t => queryParams.append('type[]', t));
      activeFilters.tags.forEach(t => queryParams.append('tags[]', t));
      activeFilters.collections.forEach(c => queryParams.append('collection[]', c));
      activeFilters.availability.forEach(a => queryParams.append('availability[]', a));
      (activeFilters.titles || []).forEach(t => queryParams.append('title[]', t));

      // Dynamic options
      Object.entries(activeFilters.options).forEach(([name, values]) => {
        values.forEach(val => queryParams.append(`options[${name}][]`, val));
      });

      // Dynamic metafields
      Object.entries(activeFilters.metafields).forEach(([key, values]) => {
        values.forEach(val => queryParams.append(`metafields[${key}][]`, val));
      });

      // Sorting & Pagination
      queryParams.append('sortBy', activeFilters.sortBy);
      queryParams.append('page', activeFilters.page);
      queryParams.append('limit', PAGE_SIZE);
      // Add loading state to sidebar
      sidebar.classList.add('cfp-loading');
        if (!isLoadMore) {
          renderSkeleton();
        }
        const response = await fetch(`${API_DOMAIN}/api/filter?${queryParams.toString()}`);
      const data = await response.json();

      console.log('[CFP] API Response:', data);

      sidebar.classList.remove('cfp-loading');

      if (data.globalSettings) {
        globalSettings = data.globalSettings;
        window.cfpGlobalSettings = globalSettings;
        applyGlobalSettings(globalSettings);
      }
      
      const grid = document.getElementById('cfp-products-grid');
      
      // Did You Mean UI
      if (data.didYouMean && templateName === 'search') {
         let dymContainer = document.getElementById("cfp-dym-page-container");
         if (!dymContainer) {
            dymContainer = document.createElement("div");
            dymContainer.id = "cfp-dym-page-container";
            dymContainer.style.cssText = "width: 100%; margin-bottom: 24px; padding: 16px 24px; background: #fef2f2; border: 1px solid #fecaca; text-align: center; color: #991b1b; font-size: 15px; border-radius: 8px;";
            if (grid) grid.parentElement.insertBefore(dymContainer, grid);
         }
         if (dymContainer) {
            dymContainer.innerHTML = `Sorry, nothing found for '<strong>${searchTerms}</strong>'. Did you mean '<a href="/search?q=${data.didYouMean}" style="font-weight: bold; text-decoration: underline; color: #991b1b;">${data.didYouMean}</a>'?`;
            dymContainer.style.display = "block";
         }
      } else {
         const dymContainer = document.getElementById("cfp-dym-page-container");
         if (dymContainer) dymContainer.style.display = "none";
      }

      if (data.products) {
        renderProducts(data.products, data.totalCount, isLoadMore, data.mergedValues, data.contextualPricingApplied);
      }
      if (data.settings && data.facets) {
        cfpLastSettings = data.settings;
        cfpLastFacets = data.facets;
        cfpLastTotalCount = data.totalCount;
        renderFilterSidebar(data.settings, data.facets, data.totalCount);
      }
      renderBreadcrumbs();
      updateActiveCountBadge();
      window._cfpInitialized = true;

    } catch (e) {
      console.error("CFP: API Query error", e);
      sidebar.classList.remove('cfp-loading');
    }
  }

  function applyGlobalSettings(settings) {
    const container = document.body;
    if (!container) return;
    
    if (settings.horizontalFilters) {
      container.classList.add('cfp-horizontal-layout');
    } else {
      container.classList.remove('cfp-horizontal-layout');
    }

    if (settings.darkMode) {
      container.classList.add('cfp-dark-mode');
    } else {
      container.classList.remove('cfp-dark-mode');
    }

    if (settings.mobileFilterLayout && settings.mobileFilterLayout.toLowerCase().replace(/_/g, '-').replace(/ /g, '-') === "horizontal-scrolling") {
      container.classList.add('cfp-mobile-horizontal-scrolling');
    } else {
      container.classList.remove('cfp-mobile-horizontal-scrolling');
    }

    if (settings.desktopLikeOnMobile) {
      container.classList.add('cfp-desktop-like-mobile');
    } else {
      container.classList.remove('cfp-desktop-like-mobile');
    }
  }

  // â”€â”€ 4. Render Products Grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function renderSkeleton() {
    // Hide pagination during loading
    const oldPagination = document.querySelector('.cfp-load-more-container');
    if (oldPagination) oldPagination.style.display = 'none';

    // Ensure products container exists
    let productContainer = document.getElementById('cfp-products-container');
    if (!productContainer) {
      productContainer = document.createElement('div');
      productContainer.id = 'cfp-products-container';
      productContainer.className = 'cfp-products-grid';
      
      const wrapper = document.querySelector('.cfp-layout-wrapper');
      if (wrapper) {
        wrapper.appendChild(productContainer);
      } else {
        const main = document.querySelector('.cfp-v1-app-container') || document.body;
        main.appendChild(productContainer);
      }
    }

    // Inject the real skeleton using the exact same classes as real products
    // This ensures the browser treats them exactly like real products and doesn't collapse them
    let skeletonHtml = '';
    for (let i = 0; i < 8; i++) {
      skeletonHtml += `
        <div class="cfp-product-card cfp-skeleton-card">
          <div class="cfp-skeleton-image cfp-skeleton">&nbsp;</div>
          <div class="cfp-product-card__info" style="align-items: center;">
            <div class="cfp-skeleton-text cfp-skeleton-vendor cfp-skeleton">&nbsp;</div>
            <div class="cfp-skeleton-text cfp-skeleton-title cfp-skeleton" style="margin-top: 8px; margin-bottom: 8px;">&nbsp;</div>
            <div class="cfp-skeleton-text cfp-skeleton-price cfp-skeleton">&nbsp;</div>
          </div>
        </div>
      `;
    }
    productContainer.innerHTML = skeletonHtml;
    
    productContainer.style.setProperty('display', 'grid', 'important');
  }


  function renderProducts(products, totalCount, isLoadMore, mergedValues, contextualPricingApplied = false) {
    console.log('[CFP] Rendering products. Count:', products.length, 'Total:', totalCount);
    // Get or create our dedicated products container (a plain div, never Dawn's ul)
    let productContainer = document.getElementById('cfp-products-container');
    if (!productContainer) {
      productContainer = document.createElement('div');
      productContainer.id = 'cfp-products-container';
      productContainer.className = 'cfp-products-grid';
      const wrapper = document.querySelector('.cfp-layout-wrapper');
      if (wrapper) {
        wrapper.appendChild(productContainer);
      } else {
        const main = document.querySelector('.cfp-v1-app-container') || document.body;
        main.appendChild(productContainer);
      }
    }
    const grid = productContainer;
    // Make products container visible (skeleton may have hidden it)
    grid.style.display = 'grid';

    // Inject products into Wishlist App's global pageDataMap if it exists
    if (typeof window.pageDataMap !== 'undefined') {
      products.forEach(product => {
        let variantId = product.variants?.[0]?.id;
        if (variantId && typeof variantId === 'string') {
          variantId = variantId.replace('gid://shopify/ProductVariant/', '');
        }
        let productId = product.id;
        if (productId && typeof productId === 'string') {
          productId = productId.replace('gid://shopify/Product/', '');
        }
        const firstVariant = product.variants?.[0] || {};
        let variantTitle = "";
        if (firstVariant.option1 && firstVariant.option1 !== 'Default Title') variantTitle += firstVariant.option1;
        if (firstVariant.option2) variantTitle += " / " + firstVariant.option2;
        if (firstVariant.option3) variantTitle += " / " + firstVariant.option3;
        
        const price = firstVariant.price !== undefined ? parseFloat(firstVariant.price) * 100 : (parseFloat(product.priceMin || 0) * 100);
        const compareAtPrice = firstVariant.compareAtPrice ? parseFloat(firstVariant.compareAtPrice) * 100 : null;

        window.pageDataMap[product.handle] = {
           ...firstVariant,
           id: variantId,
           title: variantTitle || 'Default Title',
           price: price,
           compare_at_price: compareAtPrice,
           available: firstVariant.available !== false,
           product_id: productId,
           product_handle: product.handle,
           product_image: product.merchandisingImage || product.images?.[0],
           product_title: product.title
        };
      });
    }

    // Update count labels
    const countLabel = document.querySelector('.cfp-product-count');
    if (countLabel) {
      if (globalSettings && globalSettings.showProductCount === false) {
        countLabel.style.display = 'none';
      } else {
        countLabel.style.display = '';
        countLabel.textContent = `${totalCount} product${totalCount === 1 ? '' : 's'}`;
      }
    }

    if (templateName === 'search') {
      document.title = document.title.replace(/\d+\s*results?/i, `${totalCount} result${totalCount === 1 ? '' : 's'}`);
    }

    if (products.length === 0) {
      const emptyStateSvg = `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path><circle cx="9" cy="14" r="1" fill="#94a3b8"></circle><circle cx="15" cy="14" r="1" fill="#94a3b8"></circle><path d="M10 18c1-1 3-1 4 0"></path></svg>`;
      const emptyMsg = searchTerms && Object.keys(activeFilters).every(k => k === 'page' || k === 'sortBy' || (Array.isArray(activeFilters[k]) ? activeFilters[k].length === 0 : !activeFilters[k]))
         ? `No matches found for <strong>'${searchTerms}'</strong>. Please try again with a different term.`
         : `No products match your selected filters.`;

      grid.innerHTML = `
        <div class="cfp-no-products" style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center; color: #475569; font-size: 15px;">
          ${emptyStateSvg}
          <p style="margin: 0;">${emptyMsg}</p>
          <button class="cfp-btn cfp-btn--primary" id="cfp-reset-inline" style="max-width: 137px; margin: 23px auto 0; width: 100%;">Reset Filters</button>
        </div>
      `;
      const resetBtn = document.getElementById('cfp-reset-inline');
      if (resetBtn) resetBtn.addEventListener('click', clearAllFilters);
      renderPagination(grid, totalCount);
      return;
    }

    // Apply grid layout without removing existing theme classes
    grid.classList.add('cfp-products-grid');

    
    const productsHtml = products.map(product => {

      let variantImg = null;
      let matchedVariantId = null;
      let matchedVariant = null;
        if (activeFilters.options && Object.keys(activeFilters.options).length > 0) {
          const selectedValues = [];
          Object.values(activeFilters.options).forEach(arr => selectedValues.push(...arr));
          
          // Expand selected values using mergedValues to ensure we match variants correctly
          let expandedSelectedValues = [...selectedValues];
          if (mergedValues && mergedValues.length > 0) {
              for(const v of selectedValues) {
                 const rules = mergedValues.filter(m => m.targetValue.toLowerCase() === v.toLowerCase());
                 for(const r of rules) {
                     expandedSelectedValues.push(...r.sourceValues);
                 }
              }
          }

          if (selectedValues.length > 0 && product.variants && product.variants.length > 0) {
            // Lowercase all for case-insensitive matching
            const expandedLower = expandedSelectedValues.map(x => x.trim().toLowerCase());
            
            let bestScore = -1;
            
            product.variants.forEach(v => {
               let score = 0;
               const vOpts = [v.option1, v.option2, v.option3]
                  .filter(Boolean)
                  .map(x => x.trim().toLowerCase());
                  
               expandedLower.forEach(val => {
                   if (vOpts.includes(val)) score++;
               });
               
               if (score > bestScore) {
                   bestScore = score;
                   matchedVariant = v;
               }
            });
            
            if (bestScore === 0) matchedVariant = null;
            if (matchedVariant) {
              if (matchedVariant.imageUrl) {
                variantImg = matchedVariant.imageUrl;
              }
              matchedVariantId = matchedVariant.id ? matchedVariant.id.replace('gid://shopify/ProductVariant/', '') : null;
            }
          }
        }
        let customImage = null;
        const handle = collectionHandle || '';
        
        let urlParams = new URLSearchParams(window.location.search);
        let activeCollections = urlParams.getAll('collections').join(' ').toLowerCase();
        let handleAndFilters = (handle + ' ' + activeCollections).toLowerCase();
        
        // Parse metafield image - can be string URL or object with url property
        const parseMetafieldImage = (val) => {
          if (!val) return null;
          if (typeof val === 'string') return val;
          if (typeof val === 'object') {
            return val.url || val.src || val.image?.url || null;
          }
          return null;
        };

        if ((handleAndFilters.includes('plus-size') || handleAndFilters.includes('plus size'))) {
            customImage = parseMetafieldImage(product['metafield_custom.plus_size_collection_image']);
        } else {
            let mobImage = parseMetafieldImage(product['metafield_custom.mob_collection_image']) || parseMetafieldImage(product['metafield_custom.mother_of_the_bride_collection_image']);
            if ((handleAndFilters.includes('mother-of-the-bride') || handleAndFilters.includes('mob') || handleAndFilters.includes('mother of the bride')) && mobImage) {
                customImage = mobImage;
            } else if (handleAndFilters.includes('wedding')) {
                customImage = parseMetafieldImage(product['metafield_custom.wedding_collection_image']);
            }
        }
  
        // Resize shopify image URL to avoid massive memory usage on storefront
        const getResizedImageUrl = (url, size = '600x') => {
           if (!url || typeof url !== 'string') return url;
           if (url.indexOf('cdn.shopify.com') === -1) return url;
           // If it already has size params, just return or handle safely. This basic regex appends _600x before extension.
           return url.replace(/_(pico|icon|thumb|small|compact|medium|large|grande|original|1024x1024|2048x2048|master)+\./g, '.')
                     .replace(/\.([a-zA-Z0-9]+)(\?.*)?$/, `_${size}.$1$2`);
        };
  
        let primaryImg = customImage || variantImg || product.merchandisingImage || product.images?.[0] || 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_600x.gif';
        primaryImg = getResizedImageUrl(primaryImg, '600x');
        
        let productUrl = `/products/${product.handle}`;
        if (typeof matchedVariantId !== 'undefined' && matchedVariantId) {
           productUrl += `?variant=${matchedVariantId}`;
        }
      let rate = 1;
      if (!contextualPricingApplied && window.Shopify && window.Shopify.currency && window.Shopify.currency.rate) {
        rate = parseFloat(window.Shopify.currency.rate) || 1;
      }
      
      let symbol = '$';
      if (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) {
         try {
            const parts = new Intl.NumberFormat('en-US', { style: 'currency', currency: window.Shopify.currency.active }).formatToParts(0);
            const sym = parts.find(p => p.type === 'currency');
            if (sym) symbol = sym.value;
         } catch(e) {
            symbol = (window.cfpCurrency && window.cfpCurrency.symbol) ? window.cfpCurrency.symbol : '$';
         }
      } else {
         symbol = (window.cfpCurrency && window.cfpCurrency.symbol) ? window.cfpCurrency.symbol : '$';
      }
      
      let basePrice = product.priceMin;
      let baseComparePrice = product.variants?.[0]?.compareAtPrice;

      if (matchedVariant) {
         if (matchedVariant.price !== undefined && matchedVariant.price !== null) {
            basePrice = matchedVariant.price;
         }
         if (matchedVariant.compareAtPrice !== undefined && matchedVariant.compareAtPrice !== null) {
            baseComparePrice = matchedVariant.compareAtPrice;
         } else {
            baseComparePrice = null;
         }
      }

      const priceVal = parseFloat(basePrice) * rate;
      const price = priceVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      
      let comparePrice = null;
      let onSale = false;
      if (baseComparePrice) {
        const compareVal = parseFloat(baseComparePrice) * rate;
        comparePrice = compareVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        onSale = compareVal > priceVal;
      }

      // Extract Color Swatches from Variants
      let colorOptionIndex = -1;
      let parsedOptions = [];
      if (product.options) {
        try {
          parsedOptions = typeof product.options === 'string' ? JSON.parse(product.options) : product.options;
          colorOptionIndex = parsedOptions.findIndex(o => o.name && (o.name.toLowerCase() === 'color' || o.name.toLowerCase() === 'colour'));
        } catch(e){}
      }

      let swatchesHtml = "";
      if (colorOptionIndex !== -1 && product.variants && product.variants.length > 0) {
        const optionKey = `option${colorOptionIndex + 1}`;
        const uniqueColors = new Map();

        let expandedLower = [];
        if (activeFilters.options && Object.keys(activeFilters.options).length > 0) {
            let sv = [];
            Object.values(activeFilters.options).forEach(arr => sv.push(...arr));
            let expanded = [...sv];
            if (typeof mergedValues !== 'undefined' && mergedValues && mergedValues.length > 0) {
                for(const v of sv) {
                    const rules = mergedValues.filter(m => m.targetValue.toLowerCase() === v.toLowerCase());
                    for(const r of rules) {
                        expanded.push(...r.sourceValues);
                    }
                }
            }
            expandedLower = expanded.map(x => x.trim().toLowerCase());
        }

        product.variants.forEach(v => {
          const colorName = v[optionKey];
          if (colorName && v.imageUrl) {
            const numericId = v.id ? v.id.replace('gid://shopify/ProductVariant/', '') : '';
            
            let score = 0;
            if (expandedLower.length > 0) {
                const vOpts = [v.option1, v.option2, v.option3].filter(Boolean).map(x => x.trim().toLowerCase());
                expandedLower.forEach(val => { if (vOpts.includes(val)) score++; });
            }

            if (!uniqueColors.has(colorName)) {
                uniqueColors.set(colorName, { imgUrl: v.imageUrl, variantId: numericId, score: score });
            } else {
                // Keep the variant that matches the active filters (like size) better!
                if (score > uniqueColors.get(colorName).score) {
                    uniqueColors.set(colorName, { imgUrl: v.imageUrl, variantId: numericId, score: score });
                }
            }
          }
        });

        if (uniqueColors.size > 0) {
          swatchesHtml += `<div class="cfp-product-swatches">`;
          const colorsArray = Array.from(uniqueColors.entries());
          
          let activeIndex = 0;
          let matchedColorUrl = "";
          let colorWasFiltered = false;

          // 1. Check if there's a search query matching a color
          if (activeFilters.q && activeFilters.q.trim() !== "") {
             const qLower = activeFilters.q.toLowerCase().trim();
             const foundIndex = colorsArray.findIndex(c => c[0].toLowerCase().includes(qLower) || qLower.includes(c[0].toLowerCase()));
             if (foundIndex !== -1) {
                activeIndex = foundIndex;
                colorWasFiltered = true;
             }
          } else if (activeFilters.options && Object.keys(activeFilters.options).length > 0) {
             // 2. Check if there's an active color filter matching a color
             let selectedValues = [];
             Object.values(activeFilters.options).forEach(arr => selectedValues.push(...arr));
             if (mergedValues && mergedValues.length > 0) {
                 const expanded = [...selectedValues];
                 for(const v of selectedValues) {
                     const rules = mergedValues.filter(m => m.targetValue.toLowerCase() === v.toLowerCase());
                     for(const r of rules) {
                         expanded.push(...r.sourceValues);
                     }
                 }
                 selectedValues = expanded;
             }
             const expandedLower = selectedValues.map(x => x.toLowerCase());
             const foundIndex = colorsArray.findIndex(c => expandedLower.includes(c[0].toLowerCase()));
             if (foundIndex !== -1) {
                activeIndex = foundIndex;
                colorWasFiltered = true;
             }
          }
           
           if (activeIndex === 0 && matchedVariant && typeof optionKey !== 'undefined') {
              const matchedVariantColor = matchedVariant[optionKey];
              if (matchedVariantColor) {
                 const foundIndex = colorsArray.findIndex(c => c[0].toLowerCase() === matchedVariantColor.toLowerCase());
                 if (foundIndex !== -1) {
                    activeIndex = foundIndex;
                 }
              }
           }

           matchedColorUrl = colorsArray[activeIndex][1].imgUrl;

          colorsArray.forEach(([colorName, data], index) => {
             const isHidden = index >= 5 ? 'cfp-swatch-hidden' : '';
             const isActive = index === activeIndex ? 'cfp-swatch-active' : '';
             
             let hoverImgUrlForSwatch = '';
             if (globalSettings && globalSettings.secondImageOnHover !== false && Array.isArray(product.images) && data.imgUrl) {
                 const targetUrlBase = data.imgUrl.split('?')[0].replace(/^https?:/, '');
                 let foundIdx = -1;
                 for (let i=0; i<product.images.length; i++) {
                     let src = typeof product.images[i] === 'object' ? product.images[i].src : product.images[i];
                     if (src && (src.includes(targetUrlBase) || targetUrlBase.includes(src.split('?')[0].replace(/^https?:/, '')))) {
                         foundIdx = i;
                         break;
                     }
                 }
                 if (foundIdx !== -1 && foundIdx + 1 < product.images.length) {
                     let nextImg = product.images[foundIdx + 1];
                     let nextImgSrc = typeof nextImg === 'object' ? nextImg.src : nextImg;
                     
                     let isVariantImage = false;
                     if (product.variants) {
                         const nextUrlBase = nextImgSrc.split('?')[0].replace(/^https?:/, '');
                         isVariantImage = product.variants.some(v => v.imageUrl && (v.imageUrl.includes(nextUrlBase) || nextUrlBase.includes(v.imageUrl.split('?')[0].replace(/^https?:/, ''))));
                     }
                     if (!isVariantImage) {
                         hoverImgUrlForSwatch = nextImgSrc;
                     }
                 }
             }

             const secondaryImgJS = `
               const secImg = card.querySelector('.cfp-product-card__image--secondary');
               if (secImg) {
                   ${hoverImgUrlForSwatch ? `secImg.src='${getResizedImageUrl(hoverImgUrlForSwatch, '600x')}'; secImg.style.display='';` : `secImg.style.display='none';`}
               }
             `;
             
             swatchesHtml += `<div class="cfp-swatch-item ${isHidden} ${isActive}" 
                  data-tooltip="${colorName}" 
                  onclick="event.preventDefault(); 
                           const card = this.closest('.cfp-product-card');
                           card.querySelector('.cfp-product-card__image--primary').src='${getResizedImageUrl(data.imgUrl, '600x')}';
                           ${secondaryImgJS.replace(/\n/g, ' ')}
                           const swatches = this.closest('.cfp-product-swatches').querySelectorAll('.cfp-swatch-item');
                           swatches.forEach(s => s.classList.remove('cfp-swatch-active'));
                           this.classList.add('cfp-swatch-active');
                           if('${data.variantId}') card.querySelector('a').href='/products/${product.handle}?variant=${data.variantId}';">
                <img src="${getResizedImageUrl(data.imgUrl, '50x')}" alt="${colorName}" />
             </div>`;
          });
          
          if (colorsArray.length > 5) {
             const extraCount = colorsArray.length - 5;
             swatchesHtml += `<div class="cfp-swatch-more" 
                  onclick="event.preventDefault(); 
                           const container = this.closest('.cfp-product-swatches');
                           const hiddenItems = container.querySelectorAll('.cfp-swatch-item:nth-child(n+6)');
                           const isExpanded = this.textContent.startsWith('-');
                           hiddenItems.forEach(item => item.classList.toggle('cfp-swatch-hidden'));
                           this.textContent = isExpanded ? '+' + ${extraCount} : '-' + ${extraCount};
                  ">+${extraCount}</div>`;
          }
          swatchesHtml += `</div>`;
          
          if (matchedColorUrl && (!customImage || colorWasFiltered)) {
             primaryImg = getResizedImageUrl(matchedColorUrl, '600x');
             if (!productUrl.includes('?variant=') && colorsArray[activeIndex][1].variantId) {
                 productUrl += `?variant=${colorsArray[activeIndex][1].variantId}`;
             }
          }
        }
      }
      
      let badgesHtml = '';
      const s = window.collectionFilterProSettings || {};
      // If product available status is false, or we assume it's true unless specified
      if (product.available === false) {
          const pos = s.sold_out_label_position || 'top-right';
           if (pos !== 'none') {
             badgesHtml = `<span class="cfp-product-card__badge cfp-badge--${pos}" style="background-color: var(--cfp-sold-out-bg); color: var(--cfp-sold-out-text); z-index: 2;">Sold out</span>`;
           }
      } else if (onSale) {
         const pos = s.sale_label_position || 'top-right';
           if (pos !== 'none') {
             badgesHtml = `<span class="cfp-product-card__badge cfp-badge--${pos}" style="background-color: var(--cfp-sale-bg); color: var(--cfp-sale-text); z-index: 2;">Sale</span>`;
           }
      }

      let wishlistHtml = '';
      // console.log("CFP DEBUG: globalSettings.integrations =>", globalSettings?.integrations);
      if (typeof window.pageDataMap !== 'undefined' && globalSettings && globalSettings.integrations && globalSettings.integrations.wishlist === true) {
        wishlistHtml = `<div class="wishlist-btn-container" data-product-id="${product.handle}" style="position: absolute; top: 10px; right: 10px; z-index: 2;">
             <button type="button" class="wishlist-toggle-btn" style="background: transparent; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; outline: none; box-shadow: none;">
                <svg class="wishlist-icon-svg" style="overflow: visible;" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#121212" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19.6706 5.4736C17.6806 3.8336 14.7206 4.1236 12.8906 5.9536L12.0006 6.8436L11.1106 5.9536C9.29063 4.1336 6.32064 3.8336 4.33064 5.4736C2.05064 7.3536 1.93063 10.7436 3.97063 12.7836L11.6406 20.4536C11.8406 20.6536 12.1506 20.6536 12.3506 20.4536L20.0206 12.7836C22.0706 10.7436 21.9506 7.3636 19.6706 5.4736Z"></path></svg>
             </button>
          </div>`;
      }

      let hoverImageHtml = '';
      if (globalSettings && globalSettings.secondImageOnHover !== false && Array.isArray(product.images) && product.images.length > 1) {
        let hoverImg = product.images[1];
        let hoverImgSrc = typeof hoverImg === 'object' && hoverImg.src ? hoverImg.src : hoverImg;
        if (typeof hoverImgSrc === 'string' && hoverImgSrc) {
           hoverImageHtml = `<img src="${getResizedImageUrl(hoverImgSrc, '600x')}" alt="${product.title}" class="cfp-product-card__image cfp-product-card__image--secondary" loading="lazy" />`;
        }
      }

      return `
        <div class="cfp-product-card">
          <div class="cfp-product-card__image-wrapper" style="position: relative;">
            <a href="${productUrl}" class="cfp-product-card__link">
              <div class="cfp-product-card__image-container">
                <img src="${primaryImg}" alt="${product.title}" class="cfp-product-card__image cfp-product-card__image--primary" loading="lazy" />
                ${hoverImageHtml}
                ${badgesHtml}
                ${wishlistHtml}
              </div>
            </a>
            ${(globalSettings && globalSettings.showQuickViewCollection !== false) ? `<button type="button" class="cfp-quick-view-btn" data-product-handle="${product.handle}">Quick View</button>` : ''}
          </div>
          <a href="${productUrl}" class="cfp-product-card__link" style="text-decoration: none; color: inherit; display: block;">
            <div class="cfp-product-card__info">
              <span class="cfp-product-card__vendor">${product.vendor}</span>
              <h3 class="cfp-product-card__title">${product.title}</h3>
              ${swatchesHtml}
              ${(globalSettings && globalSettings.isWholesale && !window.cfpCustomerLoggedIn) ? '' : `
              <div class="cfp-product-card__price-row">
                <span class="cfp-product-card__price">${symbol}${price}</span>
                ${onSale ? `<span class="cfp-product-card__compare-price">${symbol}${comparePrice}</span>` : ''}
              </div>
              `}
            </div>
          </a>
        </div>
      `;
    }).join('');
    
    if (productsHtml.length < 100 && products.length > 0) {
      console.error('[CFP] HTML generation failed or returned empty!', productsHtml);
    }

    if (isLoadMore) {
      // Remove old pagination if it exists inside grid
      const oldPagination = grid.querySelector('.cfp-load-more-container');
      if (oldPagination) oldPagination.remove();
      
      grid.insertAdjacentHTML('beforeend', productsHtml);
    } else {
      grid.innerHTML = productsHtml;
    }

    renderPagination(grid, totalCount);
  }

  function renderPagination(grid, totalCount) {
    const existing = document.querySelector('.cfp-load-more-container');
    if (existing) existing.remove();

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    if (activeFilters.page >= totalPages) return;

    const pagination = document.createElement('div');
    pagination.className = 'cfp-load-more-container';
    
    pagination.style.cssText = 'grid-column: 1 / -1 !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; padding: 40px 0 !important; width: 100% !important; max-width: 100% !important; margin: 0 auto; clear: both;';

    const viewedCount = Math.min(activeFilters.page * PAGE_SIZE, totalCount);
    const percentage = Math.round((viewedCount / totalCount) * 100);

    pagination.innerHTML = `
      <div class="cfp-progress-text" style="margin-bottom: 15px; font-size: 14px; color: #4a4a4a;">
        You've viewed ${viewedCount} of ${totalCount} products
      </div>
      <div class="cfp-progress-bar-container" style="width: 250px !important; height: 4px !important; background-color: #e0e0e0 !important; margin-bottom: 20px !important; border-radius: 2px !important; overflow: hidden !important; display: block !important;">
        <div class="cfp-progress-bar" style="display: block !important; width: ${percentage}% !important; height: 100% !important; min-height: 4px !important; background-color: #000000 !important; transition: width 0.3s ease;"></div>
      </div>
      <button class="cfp-btn cfp-btn--primary" id="cfp-load-more-btn" style="max-width: 300px; margin: 0 auto; padding: 12px 40px; font-weight: bold; letter-spacing: 1px; cursor: pointer;">
        LOAD MORE
      </button>
    `;

    pagination.querySelector('#cfp-load-more-btn').addEventListener('click', (e) => {
      const btn = e.target;
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.style.cursor = 'not-allowed';
      btn.innerHTML = '<span class="cfp-spinner" style="display:inline-block; width:16px; height:16px; border:2px solid #fff; border-radius:50%; border-top-color:transparent; animation: cfp-spin 1s linear infinite; vertical-align: middle;"></span>';
      
      activeFilters.page += 1;
      fetchAndRenderData(true);
    });

    grid.appendChild(pagination);
  }

  // â”€â”€ 5. Render Filters Sidebar dynamically â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function renderFilterSidebar(settings, facets, totalCount) {
    const body = sidebar.querySelector('.cfp-sidebar__body');
    if (!body) return;

    
    // Cache scroll position
    const scrollTop = body.scrollTop;

    // Save inner scroll areas
    body.querySelectorAll('.cfp-scroll-area').forEach(el => {
      const parentId = el.closest('.cfp-group__content') ? el.closest('.cfp-group__content').id : null;
      if (parentId) {
        cfpGroupScrollState[parentId] = el.scrollTop;
      }
    });


    let html = '';

    settings.forEach((setting, index) => {
      if (!setting.isEnabled) return;

      let type = setting.filterType || setting.type;
      if (type === 'stock_status') type = 'availability';
      const key = setting.filterKey || setting.key;
      let config = {};
      try {
        config = typeof setting.config === "string" ? JSON.parse(setting.config) : (setting.config || {});
      } catch (e) {
        config = {};
      }
      
      const adv = config.advanced || {};
      const prefix = config.prefix || "";
      const displayMode = setting.displayMode || "List";

      const getDisplayLabel = (val, pref) => {
        if (!val) return '';
        if (pref && val.toLowerCase().startsWith(pref.toLowerCase())) {
          return val.slice(pref.length);
        }
        return val;
      };

      let groupContent = '';
      let items = [];
      const activeArray = (type === 'vendor') ? activeFilters.vendors :
                          (type === 'product_type') ? activeFilters.types :
                          (type === 'collection') ? activeFilters.collections :
                          (type === 'tag' || type === 'tags') ? activeFilters.tags :
                          (type === 'price') ? activeFilters.priceRanges :
                          (type === 'title') ? (activeFilters.titles || []) :
                          (type === 'option') ? (activeFilters.options[key] || []) :
                          (activeFilters.metafields[key] || []);

      if (type === 'availability') {
        const inStockCount = facets.availability?.inStock || 0;
        const outOfStockCount = facets.availability?.outOfStock || 0;
        groupContent = `
          <label class="cfp-checkbox">
            <input type="checkbox" name="availability" value="in_stock" ${activeFilters.availability.includes('in_stock') ? 'checked' : ''}>
            <span class="cfp-checkbox__box"></span>
            <span class="cfp-checkbox__label">In Stock</span>
            <span class="cfp-checkbox__count">${inStockCount}</span>
          </label>
          <label class="cfp-checkbox">
            <input type="checkbox" name="availability" value="out_of_stock" ${activeFilters.availability.includes('out_of_stock') ? 'checked' : ''}>
            <span class="cfp-checkbox__box"></span>
            <span class="cfp-checkbox__label">Out of Stock</span>
            <span class="cfp-checkbox__count">${outOfStockCount}</span>
          </label>
        `;
      } 
      else if (type === 'price' && displayMode.toLowerCase() === 'range') {
        const s = config.sliderConfig || {};
        const prefixStr = s.sliderPrefix || (setting.type === "price_range" ? getGlobalCurrencySymbol() : "");
        const suffixStr = s.sliderSuffix || "";
        const step = s.sliderStep || 1;
        const rate = getGlobalCurrencyRate();
        // Calculate max and min price from priceRanges
        let maxLimit = 100000;
        let minLimit = 0;
        if (facets && facets.priceRanges) {
          if (facets.priceRanges.maxLimit !== undefined) {
             maxLimit = facets.priceRanges.maxLimit;
             minLimit = facets.priceRanges.minLimit;
          } else {
            const rangesList = facets.priceRanges.ranges ? facets.priceRanges.ranges : (Array.isArray(facets.priceRanges) ? facets.priceRanges : []);
            if (rangesList.length > 0) {
              const maxValues = rangesList.map(r => {
                const parts = r.label ? r.label.split('-') : [];
                return parts.length === 2 ? parseFloat(parts[1]) : 0;
              });
              const highest = Math.max(...maxValues);
              if (highest > 0) maxLimit = highest;
    
              const minValues = rangesList.map(r => {
                const parts = r.label ? r.label.split('-') : [];
                return parts.length === 2 ? parseFloat(parts[0]) : 0;
              });
              const lowest = Math.min(...minValues);
              if (lowest >= 0) minLimit = lowest;
            }
          }
        }

        if (minLimit >= maxLimit) {
          return; // Hide the price filter if there's no range to select
        }

        maxPriceLimit = maxLimit; // Update global for active badge computation if needed

        let effectiveMin = activeFilters.minPrice;
        if (effectiveMin < minLimit) effectiveMin = minLimit;
        let effectiveMax = activeFilters.maxPrice;
        if (effectiveMax === 999999 || effectiveMax > maxLimit) effectiveMax = maxLimit;
        if (effectiveMax < minLimit) effectiveMax = minLimit;

        const displayMinLimit = minLimit * rate;
        const displayMaxLimit = maxLimit * rate;
        const displayEffectiveMin = effectiveMin * rate;
        const displayEffectiveMax = effectiveMax * rate;

        const rangeDiff = displayMaxLimit - displayMinLimit;
        const fillLeft = rangeDiff > 0 ? ((displayEffectiveMin - displayMinLimit) / rangeDiff) * 100 : 0;
        const fillRight = rangeDiff > 0 ? 100 - ((displayEffectiveMax - displayMinLimit) / rangeDiff) * 100 : 0;
        
        const intervals = parseInt(s.sliderRange) > 0 ? parseInt(s.sliderRange) : 4;
        const points = intervals + 1;
        let ticksHtml = '<div class="cfp-slider-ticks" style="position: relative; height: 20px; margin-top: 8px;">';
        
        const formatValue = (val) => {
          if (val === 0) return '0';
          if (val >= 1000000) return (val / 1000000).toFixed(1).replace('.0', '') + 'M';
          if (val >= 1000) return (val / 1000).toFixed(1).replace('.0', '') + 'k';
          return val.toFixed(1).replace('.0', '');
        };
        
        const sliderColor = s.sliderColor || '#202223';

        for (let i = 0; i < points; i++) {
          const percent = (i / (points - 1)) * 100;
          const val = displayMinLimit + (i / (points - 1)) * (displayMaxLimit - displayMinLimit);
          ticksHtml += `
            <div style="position: absolute; left: ${percent}%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; top: 16px; z-index: 0; pointer-events: none;">
              <div style="width: 1px; height: 8px; background: ${sliderColor}; margin-bottom: 4px;"></div>
              <span style="font-size: 11px; color: #6d7175; font-weight: 400;">${formatValue(val)}</span>
            </div>
          `;
        }
        ticksHtml += '</div>';

        groupContent = `
          <div class="cfp-price-range" style="--slider-color: ${sliderColor};">
            <div class="cfp-price-inputs">
              <div class="cfp-price-input-wrap">
                <div class="cfp-price-field">
                  ${s.showInputPrefixSuffix !== false ? `<span class="cfp-price-symbol">${prefixStr}</span>` : ''}
                  <input type="number" id="cfp-price-min" class="cfp-price-input" value="${Math.round(displayEffectiveMin)}" min="${Math.round(displayMinLimit)}" step="${step}">
                  ${s.showInputPrefixSuffix !== false ? `<span class="cfp-price-symbol" style="padding-left:4px">${suffixStr}</span>` : ''}
                </div>
              </div>
              <span class="cfp-price-divider">-</span>
              <div class="cfp-price-input-wrap">
                <div class="cfp-price-field">
                  ${s.showInputPrefixSuffix !== false ? `<span class="cfp-price-symbol">${prefixStr}</span>` : ''}
                  <input type="number" id="cfp-price-max" class="cfp-price-input" value="${Math.round(displayEffectiveMax)}" min="${Math.round(displayMinLimit)}" step="${step}">
                  ${s.showInputPrefixSuffix !== false ? `<span class="cfp-price-symbol" style="padding-left:4px">${suffixStr}</span>` : ''}
                </div>
              </div>
            </div>
            
            <div class="cfp-range-track" id="cfp-slider-track">
              <div class="cfp-range-fill" id="cfp-slider-fill" style="left: ${fillLeft}%; right: ${fillRight}%;"></div>
              <input type="range" class="cfp-range-input" id="cfp-slider-range-min" min="${Math.round(displayMinLimit)}" max="${Math.round(displayMaxLimit)}" value="${Math.round(displayEffectiveMin)}" step="${step}">
              <input type="range" class="cfp-range-input" id="cfp-slider-range-max" min="${Math.round(displayMinLimit)}" max="${Math.round(displayMaxLimit)}" value="${Math.round(displayEffectiveMax)}" step="${step}">
              ${ticksHtml}
            </div>
          </div>
        `;
      } 
      else {
        // Resolve dynamic items
        items = [];
        if (type === 'price') {
          const rangesList = facets.priceRanges && facets.priceRanges.ranges ? facets.priceRanges.ranges : (Array.isArray(facets.priceRanges) ? facets.priceRanges : []);
          const rate = getGlobalCurrencyRate();
          const symbol = getGlobalCurrencySymbol();
          items = rangesList.map(r => {
            const minRaw = r.min !== undefined ? r.min : (r.from || 0);
            const maxRaw = r.max !== undefined ? r.max : (r.to || 0);
            
            // Format for display
            let minStrDisp = Math.round(minRaw * rate).toString();
            let maxStrDisp = Math.round(maxRaw * rate).toString();
            
            // Prepend symbol if label doesn't already include it
            const rawLabel = r.label || "";
            if (!rawLabel.includes('$') && !rawLabel.includes(symbol)) {
               minStrDisp = symbol + minStrDisp;
               maxStrDisp = symbol + maxStrDisp;
            }

            let parsedLabel = rawLabel.replace("{0}", minStrDisp).replace("{1}", maxStrDisp);
            return {
              value: `${minRaw}-${maxRaw}`,
              label: parsedLabel,
              count: r.count
            };
          });
        }
        else if (type === 'vendor') items = facets.vendors || [];
        else if (type === 'product_type') items = facets.productTypes || [];
        else if (type === 'collection') items = facets.collections || [];
        else if (type === 'tag' || type === 'tags') {
          items = facets.tags || [];
          // console.log("CFP Debug: Resolving tags for group", setting.label, "initial items:", JSON.stringify(items));
        }
        else if (type === 'title') items = facets.titles || [];
        else if (type === 'option') items = facets.options?.[key] || [];
        else if (type === 'metafield') items = facets.metafields?.[key] || [];

        if (type === 'tag' || type === 'tags') {
          // console.log("CFP Debug: Group", setting.label, "before excluded/manual check:", JSON.stringify(items));
        }

        if (!items || items.length === 0) return;

        // Apply prefix filtering for tags and collections
        if (prefix && (type === 'tag' || type === 'tags' || type === 'collection')) {
          items = items.filter(i => {
            const valStr = i.value || "";
            return valStr.toLowerCase().startsWith(prefix.toLowerCase());
          });
        }

        // Apply advanced exclusions and manual sorts
        if (config.excludedValues && config.excludedValues.length > 0) {
          items = items.filter(i => !config.excludedValues.includes(i.value));
        }
        if (config.useManualValues && config.manualValues && config.manualValues.length > 0) {
          const manualLower = config.manualValues.map(v => v.toLowerCase().trim());
          const prefixLower = prefix ? prefix.toLowerCase().trim() : '';

          items = items.filter(i => {
              let val = (i.value || "").toLowerCase().trim();
              let valStripped = val;
              if (prefixLower && val.startsWith(prefixLower)) {
                  valStripped = val.slice(prefixLower.length).trim();
              }
              return manualLower.includes(val) || manualLower.includes(valStripped);
          });
          
          if (config.sortManualValues) {
            items.sort((a,b) => {
               let valA = (a.value || "").toLowerCase().trim();
               let valAStripped = valA;
               if (prefixLower && valA.startsWith(prefixLower)) valAStripped = valA.slice(prefixLower.length).trim();
               let idxA = manualLower.indexOf(valA);
               if (idxA === -1) idxA = manualLower.indexOf(valAStripped);
               if (idxA === -1) idxA = 999;
               
               let valB = (b.value || "").toLowerCase().trim();
               let valBStripped = valB;
               if (prefixLower && valB.startsWith(prefixLower)) valBStripped = valB.slice(prefixLower.length).trim();
               let idxB = manualLower.indexOf(valB);
               if (idxB === -1) idxB = manualLower.indexOf(valBStripped);
               if (idxB === -1) idxB = 999;
               
               return idxA - idxB;
            });
          }
        }
        if (type === 'tag' || type === 'tags') {
          //  console.log("CFP Debug: Group", setting.label, "final items resolved:", JSON.stringify(items));
        }
        // Apply Values Transformation
        if (adv.valuesTransformation && adv.valuesTransformation !== "No transformation") {
          items.forEach(item => {
            let label = item.label || item.value;
            if (adv.valuesTransformation === "Uppercase") label = label.toUpperCase();
            else if (adv.valuesTransformation === "Lowercase") label = label.toLowerCase();
            else if (adv.valuesTransformation === "Capitalize") {
              label = label.replace(/\b\w/g, l => l.toUpperCase());
            }
            item.label = label;
          });
        }

        // Apply Advanced Sort
        if (!config.useManualValues || !config.sortManualValues) {
          if (adv.sortType) {
            if (adv.sortType === "Label - AZ") items.sort((a,b) => (a.label || a.value).localeCompare(b.label || b.value));
            else if (adv.sortType === "Label - ZA") items.sort((a,b) => (b.label || b.value).localeCompare(a.label || a.value));
            else if (adv.sortType === "Product count - Highest to lowest") items.sort((a,b) => b.count - a.count);
            else if (adv.sortType === "Product count - Lowest to highest") items.sort((a,b) => a.count - b.count);
          }
        }
        
        if (items.length === 0) return;

        if (globalSettings && globalSettings.showFilterOptionsWithOneItem === false) {
           if (items.length === 1 && items[0].count === totalCount) {
              return; // skip rendering this filter group
           }
        }


        const inputName = (type === 'option') ? `option-${key}` : 
                          (type === 'metafield') ? `metafield-${key}` : type;

        const isColor = type === 'option' && (key.toLowerCase().includes('color') || key.toLowerCase().includes('colour'));
        let resolvedMode = displayMode;
        if (resolvedMode.toLowerCase() === 'chips' || resolvedMode.toLowerCase() === 'buttons') {
          resolvedMode = 'Box/Button';
        }
        if (type === 'option' && key.toLowerCase().includes('size')) {
          resolvedMode = 'Box/Button';
        }
        
        const showMoreType = adv.showMoreType || "Scrollbar";
        const limit = 6;
        const isViewMore = (showMoreType === "View more" || showMoreType === "View more with scrollbar") && items.length > limit;
        
        // Wrapper for Max Height scroll
        const scrollClass = (showMoreType === "Scrollbar" || showMoreType === "View more with scrollbar") && items.length > 6 ? "cfp-scroll-area" : "";
        const scrollStyle = scrollClass ? `style="max-height: ${adv.maxHeight || '300px'};"` : "";

        const renderViewMoreBtn = () => {
          if (!isViewMore) return '';
          return `
            <div class="cfp-view-more-action" style="margin-top: 8px;">
              <button type="button" class="cfp-view-more-btn" style="background: none; border: none; color: #007bff; cursor: pointer; padding: 0; font-size: 13px; text-decoration: underline;">+ View more</button>
            </div>
          `;
        };

        // Render based on displayMode
        if (resolvedMode === "Dropdown") {
          groupContent = `
            <select class="cfp-select" name="${inputName}">
              <option value="">Any ${setting.label}</option>
              ${items.map(item => `
                <option value="${item.value}" ${(activeArray.includes(item.value) || ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal))) ? 'selected' : ''}>
                  ${getDisplayLabel(item.label || item.value, prefix)} ${globalSettings && globalSettings.showProductCount === false ? '' : ` (${item.count})`}
                </option>
              `).join('')}
            </select>
          `;
        }
        else if (resolvedMode === "Swatch") {
          const swatchConf = config.swatchConfig || {};
          const isCircle = swatchConf.circleSwatch !== false;
          const showLabel = swatchConf.showLabel !== false;
          const hasSearch = adv.desktopSearchBox;
          const swatchLayout = swatchConf.layout || 'List';

          groupContent = `
            ${hasSearch ? `
              <div class="cfp-search-input-wrap">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" class="cfp-search-input cfp-vendor-search" placeholder="Filter options" data-input-name="${inputName}">
              </div>
            ` : ''}
            <div class="${scrollClass}" ${scrollStyle}>
              <div class="cfp-color-grid" style="padding: 2px !important; ${(!isColor || showLabel) ? 'grid-template-columns: 1fr 1fr !important; gap: 12px 8px !important;' : 'grid-template-columns: repeat(4, 1fr) !important; gap: 8px !important;'}">
                ${(() => {

                  return items.map((item, idx) => {
                    let colorValue = getColorHex(item.value);
                    let isImageItem = false;
                    const itemValueLower = item.value.toLowerCase();
                    
                    let matchedData = null;
                    if (swatchConf.colors) {
                      for (const k in swatchConf.colors) {
                        if (k.toLowerCase() === itemValueLower) {
                          matchedData = swatchConf.colors[k];
                          break;
                        }
                      }
                    }
                    
                    if (matchedData) {
                      if (matchedData.type === 'color' && matchedData.value) colorValue = matchedData.value;
                      else if (matchedData.type === 'image' && matchedData.value) {
                        colorValue = matchedData.value;
                        isImageItem = true;
                      }
                    }
                    
                    const isWhite = !isImageItem && (colorValue.toLowerCase() === '#ffffff' || colorValue.toLowerCase() === 'white' || item.value.toLowerCase() === 'white');
                    const hide = isViewMore && idx >= limit;
                    
                    // Check if it's active
                    const isActive = activeArray.includes(item.value) || ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal));
                    
                    const isGrid = swatchLayout === 'Grid';
                    
                    let vWidth, vHeight;
                    let labelFlexDir, labelJustify, textAlign, gap;
                    
                    if (isGrid && !isColor) {
                      // Grid layout (Length, Sleeve type) - Large image, text below
                      vWidth = '100%';
                      vHeight = '65px';
                      labelFlexDir = 'column';
                      labelJustify = 'center';
                      textAlign = 'center';
                      gap = '6px';
                    } else {
                      // Normal list layout (Colors) - small circle, text right
                      vWidth = showLabel ? '22px' : '36px';
                      vHeight = showLabel ? '22px' : '36px';
                      labelFlexDir = showLabel ? 'row' : 'column';
                      labelJustify = showLabel ? 'flex-start' : 'center';
                      textAlign = showLabel ? 'left' : 'center';
                      gap = '8px';
                    }

                    const bgStyle = isImageItem ? `background: url('${colorValue}') center/${isGrid ? 'contain' : 'cover'} no-repeat; border: none !important;` : `background:${colorValue}; border: 1px solid ${isWhite ? '#ddd' : '#e1e3e5'} !important;`;
                    
                    let visualHtml = `<span class="cfp-swatch-circle" style="${bgStyle} width: ${vWidth} !important; height: ${vHeight} !important; display: inline-block; ${isCircle ? (showLabel && !isGrid ? 'border-radius: 50% !important;' : 'border-radius: 50% !important;') : 'border-radius: 4px !important;'} ${(isActive && !isImageItem) || (isActive && isImageItem && !isGrid) ? 'box-shadow: 0 0 0 2px #000;' : ''} flex-shrink: 0; margin: 2px !important; ${isActive && isImageItem && isGrid ? 'filter: drop-shadow(0px 2px 4px rgba(0,0,0,0.2));' : ''}"></span>`;


                    const spanWidthStyle = labelFlexDir === 'row' ? 'flex: 1;' : 'width: 100%;';
                    
                    return `
                      <label class="cfp-color-swatch ${hide ? 'cfp-view-more-hidden' : ''}" style="${hide ? 'display: none;' : ''} display: flex; align-items: center !important; gap: ${gap} !important; cursor: pointer; flex-direction: ${labelFlexDir} !important; justify-content: ${labelJustify} !important; text-align: ${textAlign} !important; width: 100%; box-sizing: border-box;" title="${item.value} ${globalSettings && globalSettings.showProductCount === false ? '' : ` (${item.count})`}">
                        <input type="checkbox" name="${inputName}" value="${item.value}" ${isActive ? 'checked' : ''} style="display:none;">
                        ${visualHtml}
                        ${showLabel ? `<span class="cfp-swatch-label" style="font-family: 'Poppins', sans-serif; font-size: 13px; text-align: ${textAlign} !important; color: #202223; line-height: 1.2; word-break: break-word; ${spanWidthStyle} margin: 0 !important; padding: 0 !important;">${getDisplayLabel(item.value, prefix)}</span>` : `<span class="cfp-swatch-label" style="display: none !important;">${getDisplayLabel(item.value, prefix)}</span>`}
                      </label>
                    `;
                  }).join('');
                })()}
              </div>
              ${renderViewMoreBtn()}
            </div>
          `;
        }
        else if (resolvedMode === "Box/Button" || resolvedMode === "Button" || resolvedMode === "Box") {
          const hasSearch = adv.desktopSearchBox;
          groupContent = `
            ${hasSearch ? `
              <div class="cfp-search-input-wrap">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" class="cfp-search-input cfp-vendor-search" placeholder="Filter options" data-input-name="${inputName}">
              </div>
            ` : ''}
            <div class="${scrollClass}" ${scrollStyle}>
              <div class="cfp-button-grid">
                ${items.map((item, idx) => {
                  const hide = isViewMore && idx >= limit;
                  return `
                  <label class="cfp-button-chip ${hide ? 'cfp-view-more-hidden' : ''}" style="${hide ? 'display: none;' : ''}" title="${item.value} ${globalSettings && globalSettings.showProductCount === false ? '' : ` (${item.count})`}">
                    <input type="checkbox" name="${inputName}" value="${item.value}" ${(activeArray.includes(item.value) || ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal))) ? 'checked' : ''}>
                    <span>${getDisplayLabel(item.label || item.value, prefix)}</span>
                  </label>
                  `;
                }).join('')}
              </div>
              ${renderViewMoreBtn()}
            </div>
          `;
        }
        else { // Default: List
          const hasSearch = adv.desktopSearchBox;
          groupContent = `
            ${hasSearch ? `
              <div class="cfp-search-input-wrap">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" class="cfp-search-input cfp-vendor-search" placeholder="Filter options" data-input-name="${inputName}">
              </div>
            ` : ''}
            <div class="${scrollClass}" ${scrollStyle}>
              ${items.map((item, idx) => {
                const hide = isViewMore && idx >= limit;
                return `
                <label class="cfp-checkbox ${hide ? 'cfp-view-more-hidden' : ''}" style="${hide ? 'display: none;' : ''}">
                  <input type="checkbox" name="${inputName}" value="${item.value}" ${(activeArray.includes(item.value) || ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal))) ? 'checked' : ''}>
                  <span class="cfp-checkbox__box"></span>
                  <span class="cfp-checkbox__label">${getDisplayLabel(item.label || item.value, prefix)}</span>
                  <span class="cfp-checkbox__count">${item.count}</span>
                </label>
                `;
              }).join('')}
              ${renderViewMoreBtn()}
            </div>
          `;
        }
      }

      const hasActiveSelections = (() => {
        if (type === 'price') {
          let minLimit = 0;
          if (facets && facets.priceRanges) {
            if (facets.priceRanges.minLimit !== undefined) {
               minLimit = facets.priceRanges.minLimit;
            } else {
              const rangesList = facets.priceRanges.ranges ? facets.priceRanges.ranges : (Array.isArray(facets.priceRanges) ? facets.priceRanges : []);
              if (rangesList.length > 0) {
                const minValues = rangesList.map(r => {
                  const parts = r.label ? r.label.split('-') : [];
                  return parts.length === 2 ? parseFloat(parts[0]) : 0;
                });
                const lowest = Math.min(...minValues);
                if (lowest >= 0) minLimit = lowest;
              }
            }
          }
          return activeFilters.priceRanges.length > 0 || activeFilters.minPrice > minLimit || (activeFilters.maxPrice < maxPriceLimit && activeFilters.maxPrice > minLimit);
        }
        if (type === 'availability') return activeFilters.availability.length > 0;
        
        return items.some(item => 
          activeArray.includes(item.value) || 
          ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal))
        );
      })();

      const groupId = `cfp-group-${setting.id || index}-${type}-${key || ''}`;
      let isCollapsed = adv.desktopCollapsed;
      if (cfpGroupToggleState[groupId] !== undefined) {
        isCollapsed = !cfpGroupToggleState[groupId];
      }
      
      html += `
        <div class="cfp-group" data-group="${type}-${key || ''}" data-multiple="${config.multipleSelection === true}">
          <button class="cfp-group__toggle" aria-expanded="${!isCollapsed}" aria-controls="${groupId}">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span>${setting.label}</span>
              ${adv.displayTooltip && adv.tooltipContent && adv.tooltipContent.trim() !== '' ? `
                <div class="cfp-tooltip-icon" data-tooltip="${adv.tooltipContent.replace(/"/g, '&quot;')}">?</div>
              ` : ''}
            </div>
            <div style="display: flex; align-items: center;">
              ${hasActiveSelections ? `
                <span class="cfp-clear-group" data-type="${type}" data-key="${key || ''}" style="color: #8c9196; font-size: 13px; font-family: 'Poppins', sans-serif; font-weight: 400; text-transform: none; margin-right: 12px; cursor: pointer; transition: color 0.15s;">Clear</span>
              ` : ''}
              <svg class="cfp-chevron" viewBox="0 0 20 20" style="width: 12px; height: 12px; fill: currentColor;"><path d="M5 8l5 5 5-5z" /></svg>
            </div>
          </button>
          <div class="cfp-group__content ${isCollapsed ? 'cfp-collapsed' : ''}" id="cfp-group-${setting.id || index}-${type}-${key || ''}">
            ${groupContent}
          </div>
        </div>
      `;
    });

    
    body.innerHTML = html;
    body.scrollTop = scrollTop;

    // Restore inner scroll areas
    body.querySelectorAll('.cfp-scroll-area').forEach(el => {
      const parentId = el.closest('.cfp-group__content') ? el.closest('.cfp-group__content').id : null;
      if (parentId && cfpGroupScrollState[parentId] !== undefined) {
        el.scrollTop = cfpGroupScrollState[parentId];
      }
    });


    setupCollapsibleToggles();
    setupDynamicFieldListeners();
  }

  // â”€â”€ 6. Utility: CSS Color mapper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function getColorHex(colorName) {
    const colors = {
      black: '#1a1a1a',
      white: '#ffffff',
      red: '#e63946',
      blue: '#4361ee',
      green: '#2a9d8f',
      yellow: '#e9c46a',
      orange: '#f4a261',
      pink: '#ffb5a7',
      grey: '#8d99ae',
      gray: '#8d99ae',
      purple: '#7209b7',
      brown: '#6c584c'
    };
    return colors[colorName.toLowerCase()] || colorName;
  }

  // â”€â”€ 7. Setup Interactivity Listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function setupStaticEventListeners() {
    document.body.addEventListener('click', function(e) {
      if (e.target.closest('#cfp-drawer-trigger-btn')) {
        openSidebar();
      }
    });
    if (triggerBtn) triggerBtn.addEventListener('click', openSidebar);
    if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
    if (overlay) overlay.addEventListener('click', closeSidebar);

    // Apply & Clear Buttons
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        fetchAndRenderData();
        closeSidebar();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', clearAllFilters);
    }

    // Individual group clear button click handler
    document.body.addEventListener('click', function(e) {
      const clearGroupBtn = e.target.closest('.cfp-clear-group');
      if (clearGroupBtn) {
        e.stopPropagation();
        e.preventDefault();
        const type = clearGroupBtn.getAttribute('data-type');
        const key = clearGroupBtn.getAttribute('data-key');
        clearGroupFilter(type, key);
      }
    });

    // Top Bar Sorting
    // Custom Dropdown Sorting Logic
    document.body.addEventListener('click', function(e) {
      const trigger = e.target.closest('#cfp-custom-sort-trigger');
      const dropdown = document.getElementById('cfp-custom-sort-dropdown');
      const sortContainer = document.getElementById('cfp-custom-sort');
      
      if (trigger) {
        sortContainer.classList.toggle('is-open');
      } else if (!e.target.closest('#cfp-custom-sort')) {
        if (sortContainer) sortContainer.classList.remove('is-open');
      }

      const option = e.target.closest('.cfp-custom-sort__option');
      if (option) {
        const val = option.getAttribute('data-value');
        const text = option.textContent;
        const label = document.getElementById('cfp-custom-sort-label');
        if (label) label.textContent = text;
        
        activeFilters.sortBy = val;
        activeFilters.page = 1;
        fetchAndRenderData();
        
        if (sortContainer) sortContainer.classList.remove('is-open');
      }
    });

    const sortSelect = document.getElementById('cfp-sort-select-top');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        activeFilters.sortBy = sortSelect.value;
        fetchAndRenderData();
      });
    }
  }

  function setupCollapsibleToggles() {
    sidebar.querySelectorAll('.cfp-group__toggle').forEach(toggle => {
      // Re-bind click event
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        const contentId = toggle.getAttribute('aria-controls');
        const content = document.getElementById(contentId);
        toggle.setAttribute('aria-expanded', String(!expanded));
        if (content) content.classList.toggle('cfp-collapsed', expanded);
          cfpGroupToggleState[contentId] = !expanded;
      });
    });
  }

  function setupDynamicFieldListeners() {
    // Search input for all filter types
    sidebar.querySelectorAll('.cfp-search-input').forEach(searchInput => {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        const wrapper = searchInput.closest('.cfp-group');
        
        let visibleCount = 0;

        // 1. Local filter
        wrapper.querySelectorAll('.cfp-checkbox, .cfp-button-chip, .cfp-color-swatch').forEach(label => {
          let txtVal = '';
          if (label.classList.contains('cfp-checkbox')) {
            const txt = label.querySelector('.cfp-checkbox__label');
            txtVal = txt ? txt.textContent : '';
          } else if (label.classList.contains('cfp-button-chip')) {
            const txt = label.querySelector('span');
            txtVal = txt ? txt.textContent : '';
          } else if (label.classList.contains('cfp-color-swatch')) {
            const txt = label.querySelector('.cfp-swatch-label');
            const titleVal = label.getAttribute('title') || '';
            txtVal = (txt ? txt.textContent : '') + " " + titleVal;
          }
          
          const matches = txtVal.toLowerCase().includes(q);
          label.classList.toggle('cfp-search-hidden', !matches);
          if (matches) visibleCount++;
        });

        let emptyState = wrapper.querySelector('.cfp-empty-state');
        if (visibleCount === 0) {
           if (!emptyState) {
              const groupNameElement = wrapper.querySelector('.cfp-group-title');
              const groupName = groupNameElement ? groupNameElement.textContent.trim().replace(/[-+]$/, '').trim() : 'Filter';
              emptyState = document.createElement('div');
              emptyState.className = 'cfp-empty-state';
              emptyState.style.padding = '10px 0';
              emptyState.style.color = '#6d7175';
              emptyState.style.fontSize = '13px';
              emptyState.style.textAlign = 'center';
              emptyState.textContent = `${groupName} not available`;
              
              const scrollArea = wrapper.querySelector('.cfp-scroll-area') || wrapper.querySelector('.cfp-search-input-wrap').nextElementSibling;
              if (scrollArea) {
                  scrollArea.appendChild(emptyState);
              } else {
                  wrapper.appendChild(emptyState);
              }
           }
           emptyState.style.display = 'block';
        } else {
           if (emptyState) emptyState.style.display = 'none';
        }

        // 2. API fetch for facet search
        const inputName = searchInput.dataset.inputName;
        if (!inputName || q.length < 2) return;

        let facetName = inputName;
        if (facetName.startsWith('option-')) facetName = facetName.replace('option-', 'options.');
        if (facetName.startsWith('metafield-')) facetName = facetName.replace('metafield-', 'metafields.');

        if (window.cfpFacetSearchTimeout) clearTimeout(window.cfpFacetSearchTimeout);
        
        window.cfpFacetSearchTimeout = setTimeout(async () => {
           try {
              const queryParams = new URLSearchParams(window.location.search);
              queryParams.append('shop', shop);
              queryParams.append('facetName', facetName);
              queryParams.append('facetQuery', q);
              if (collectionHandle) queryParams.append('collectionHandle', collectionHandle);
              else if (collectionId) queryParams.append('collectionId', collectionId);
        
              const response = await fetch(`${API_DOMAIN}/api/facet?${queryParams.toString()}`);
              const data = await response.json();
              
              if (data && data.facetHits && data.facetHits.length > 0) {
                 let hasNew = false;
                 let targetFacetArray = null;
                 if (facetName.startsWith('options.')) {
                    const optName = facetName.replace('options.', '');
                    if (!cfpLastFacets.options) cfpLastFacets.options = {};
                    if (!cfpLastFacets.options[optName]) cfpLastFacets.options[optName] = [];
                    targetFacetArray = cfpLastFacets.options[optName];
                 } else if (facetName.startsWith('metafields.')) {
                    const metaName = facetName.replace('metafields.', '');
                    if (!cfpLastFacets.metafields) cfpLastFacets.metafields = {};
                    if (!cfpLastFacets.metafields[metaName]) cfpLastFacets.metafields[metaName] = [];
                    targetFacetArray = cfpLastFacets.metafields[metaName];
                 } else if (facetName === 'vendor') {
                    if (!cfpLastFacets.vendors) cfpLastFacets.vendors = [];
                    targetFacetArray = cfpLastFacets.vendors;
                 } else if (facetName === 'type') {
                    if (!cfpLastFacets.productTypes) cfpLastFacets.productTypes = [];
                    targetFacetArray = cfpLastFacets.productTypes;
                 } else if (facetName === 'tags') {
                    if (!cfpLastFacets.tags) cfpLastFacets.tags = [];
                    targetFacetArray = cfpLastFacets.tags;
                 }
                 
                 if (targetFacetArray) {
                    data.facetHits.forEach(hit => {
                       const exists = targetFacetArray.find(v => v.value.toLowerCase() === hit.value.toLowerCase());
                       if (!exists) {
                          targetFacetArray.push({ value: hit.value, count: hit.count });
                          hasNew = true;
                          
                          // Also append to manualValues if this group uses it, so it can be rendered
                          if (cfpLastSettings) {
                             const groupSetting = cfpLastSettings.find(s => (s.filterType === 'option' && s.filterKey === inputName.replace('option-', '')) || (s.filterType === 'metafield' && s.filterKey === inputName.replace('metafield-', '')) || (s.filterType === inputName));
                             if (groupSetting && groupSetting.config && groupSetting.config.useManualValues) {
                                if (groupSetting.config.manualValues) {
                                   if (!groupSetting.config.manualValues.toLowerCase().includes(hit.value.toLowerCase())) {
                                      groupSetting.config.manualValues += `, ${hit.value}`;
                                   }
                                } else {
                                   groupSetting.config.manualValues = hit.value;
                                }
                             }
                          }
                       }
                    });
                 }
                 
                 if (hasNew) {
                    // Remember focus and value
                    const activeSearchInputName = document.activeElement ? document.activeElement.dataset?.inputName : null;
                    const activeSearchInputValue = document.activeElement ? document.activeElement.value : '';
                    
                    renderFilterSidebar(cfpLastSettings, cfpLastFacets, cfpLastTotalCount);
                    
                    if (activeSearchInputName) {
                       const newSearchInput = sidebar.querySelector(`.cfp-search-input[data-input-name="${activeSearchInputName}"]`);
                       if (newSearchInput) {
                           newSearchInput.focus();
                           newSearchInput.value = activeSearchInputValue;
                           newSearchInput.dispatchEvent(new Event('input')); // re-trigger local filter
                       }
                    }
                 }
              }
           } catch(e) {
              console.error("CFP Facet API Error:", e);
           }
        }, 300);
      });
    });

    // View more toggle
    sidebar.querySelectorAll('.cfp-view-more-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const wrapper = btn.closest('.cfp-group__content');
        const hiddenItems = wrapper.querySelectorAll('.cfp-view-more-hidden');
        const isExpanded = btn.textContent.includes('less');
        
        if (isExpanded) {
          hiddenItems.forEach(el => el.style.display = 'none');
          btn.textContent = '+ View more';
        } else {
          hiddenItems.forEach(el => el.style.display = '');
          btn.textContent = '- View less';
        }
      });
    });

    // Price input changes
    const minInput = document.getElementById('cfp-price-min');
    const maxInput = document.getElementById('cfp-price-max');
    const rangeMin = document.getElementById('cfp-slider-range-min');
    const rangeMax = document.getElementById('cfp-slider-range-max');
    const fill = document.getElementById('cfp-slider-fill');

    function updateFill() {
      if(!fill || !rangeMin || !rangeMax) return;
      const minVal = parseFloat(rangeMin.value) || 0;
      const maxVal = parseFloat(rangeMax.value) || 0;
      const minLimit = parseFloat(rangeMin.min) || 0;
      const maxLimit = parseFloat(rangeMin.max) || 1000;
      const rangeDiff = maxLimit - minLimit;
      
      let leftPercent = rangeDiff > 0 ? ((minVal - minLimit) / rangeDiff) * 100 : 0;
      let rightPercent = rangeDiff > 0 ? 100 - ((maxVal - minLimit) / rangeDiff) * 100 : 0;
      if(leftPercent < 0) leftPercent = 0;
      if(rightPercent < 0) rightPercent = 0;
      if(leftPercent > 100) leftPercent = 100;
      if(rightPercent > 100) rightPercent = 100;
      
      fill.style.left = `${leftPercent}%`;
      fill.style.right = `${rightPercent}%`;
      
      if (minVal >= maxLimit) {
        rangeMin.style.zIndex = "5";
      } else {
        rangeMin.style.zIndex = "3";
      }
    }

    if (minInput && maxInput) {
      const applyPriceFilter = () => {
        const rate = getGlobalCurrencyRate();
        let minV = parseFloat(minInput.value) || 0;
        let maxV = parseFloat(maxInput.value) || (999999 * rate);
        if(minV > maxV) { let t=minV; minV=maxV; maxV=t; minInput.value=minV; maxInput.value=maxV; }
        activeFilters.minPrice = minV / rate;
        activeFilters.maxPrice = maxV / rate;
        activeFilters.page = 1;
        fetchAndRenderData();
      };

      minInput.addEventListener('change', () => {
        if(rangeMin) {
          rangeMin.value = minInput.value;
          updateFill();
        }
        applyPriceFilter();
      });

      maxInput.addEventListener('change', () => {
        if(rangeMax) {
          rangeMax.value = maxInput.value;
          updateFill();
        }
        applyPriceFilter();
      });
    }

    if (rangeMin && rangeMax) {
      rangeMin.addEventListener('input', () => {
        let minVal = parseFloat(rangeMin.value);
        let maxVal = parseFloat(rangeMax.value);
        if (minVal > maxVal) {
          rangeMin.value = maxVal;
          minVal = maxVal;
        }
        if (minInput) minInput.value = minVal;
        updateFill();
      });

      rangeMin.addEventListener('change', () => {
        const rate = getGlobalCurrencyRate();
        activeFilters.minPrice = parseFloat(rangeMin.value) / rate;
        activeFilters.page = 1;
        fetchAndRenderData();
      });

      rangeMax.addEventListener('input', () => {
        let minVal = parseFloat(rangeMin.value);
        let maxVal = parseFloat(rangeMax.value);
        if (maxVal < minVal) {
          rangeMax.value = minVal;
          maxVal = minVal;
        }
        if (maxInput) maxInput.value = maxVal;
        updateFill();
      });

      rangeMax.addEventListener('change', () => {
        const rate = getGlobalCurrencyRate();
        activeFilters.maxPrice = parseFloat(rangeMax.value) / rate;
        activeFilters.page = 1;
        fetchAndRenderData();
      });
    }

    // Dropdowns change listeners
    sidebar.querySelectorAll('.cfp-sidebar__body select.cfp-select').forEach(select => {
      select.addEventListener('change', () => {
        const name = select.name;
        const val = select.value;
        
        activeFilters.page = 1;
        
        let arr = [];
        if (name === 'availability') arr = activeFilters.availability;
        else if (name === 'vendor') arr = activeFilters.vendors;
        else if (name === 'product_type') arr = activeFilters.types;
        else if (name === 'collection') arr = activeFilters.collections;
        else if (name === 'tag' || name === 'tags') arr = activeFilters.tags;
        else if (name === 'title') arr = activeFilters.titles;
        else if (name.startsWith('option-')) {
          const optionName = name.replace('option-', '');
          if (!activeFilters.options[optionName]) activeFilters.options[optionName] = [];
          arr = activeFilters.options[optionName];
        } else if (name.startsWith('metafield-')) {
          const metafieldKey = name.replace('metafield-', '');
          if (!activeFilters.metafields[metafieldKey]) activeFilters.metafields[metafieldKey] = [];
          arr = activeFilters.metafields[metafieldKey];
        }

        // Clear existing selections for this dropdown and set the new one
        arr.length = 0;
        if (val) arr.push(val);

        fetchAndRenderData();
      });
    });

    // Checkboxes change listeners
    sidebar.querySelectorAll('.cfp-sidebar__body input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const name = checkbox.name;
        const val = checkbox.value;
        const checked = checkbox.checked;

        const groupEl = checkbox.closest('.cfp-group');
        const isMultiple = groupEl ? groupEl.getAttribute('data-multiple') === 'true' : true;

        if (!isMultiple && checked) {
          groupEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            if (cb !== checkbox) {
              cb.checked = false;
              const cbVal = cb.value;
              if (name === 'availability') updateFilterArray(activeFilters.availability, cbVal, false);
              else if (name === 'vendor') updateFilterArray(activeFilters.vendors, cbVal, false);
              else if (name === 'product_type') updateFilterArray(activeFilters.types, cbVal, false);
              else if (name === 'collection') updateFilterArray(activeFilters.collections, cbVal, false);
              else if (name === 'tag' || name === 'tags') updateFilterArray(activeFilters.tags, getCleanLabel('tag', cbVal).cleanVal, false);
              else if (name === 'price') updateFilterArray(activeFilters.priceRanges, cbVal, false);
              else if (name === 'title') updateFilterArray(activeFilters.titles, cbVal, false);
              else if (name.startsWith('option-')) {
                const optionName = name.replace('option-', '');
                if (activeFilters.options[optionName]) updateFilterArray(activeFilters.options[optionName], cbVal, false);
              }
              else if (name.startsWith('metafield-')) {
                const metafieldKey = name.replace('metafield-', '');
                if (activeFilters.metafields[metafieldKey]) updateFilterArray(activeFilters.metafields[metafieldKey], cbVal, false);
              }
            }
          });
        }

        activeFilters.page = 1;

        if (name === 'availability') {
          updateFilterArray(activeFilters.availability, val, checked);
        } else if (name === 'vendor') {
          updateFilterArray(activeFilters.vendors, val, checked);
        } else if (name === 'product_type') {
          updateFilterArray(activeFilters.types, val, checked);
        } else if (name === 'collection') {
          updateFilterArray(activeFilters.collections, val, checked);
        } else if (name === 'tag' || name === 'tags') {
          updateFilterArray(activeFilters.tags, getCleanLabel('tag', val).cleanVal, checked);
        } else if (name === 'price') {
          updateFilterArray(activeFilters.priceRanges, val, checked);
          if (activeFilters.priceRanges.length > 0) {
            let globalMin = Infinity;
            let globalMax = 0;
            activeFilters.priceRanges.forEach(r => {
              const parts = r.split('-');
              const minVal = parseFloat(parts[0]) || 0;
              const maxVal = (parts[1] === "" || parts[1] === "Infinity" || parts[1] === "null" || parts[1] === "undefined") ? 999999 : parseFloat(parts[1]);
              if (minVal < globalMin) globalMin = minVal;
              if (maxVal > globalMax) globalMax = maxVal;
            });
            activeFilters.minPrice = globalMin;
            activeFilters.maxPrice = globalMax;
          } else {
            activeFilters.minPrice = 0;
            activeFilters.maxPrice = 999999;
          }
        } else if (name === 'title') {
          updateFilterArray(activeFilters.titles, val, checked);
        } else if (name.startsWith('option-')) {
          const optionName = name.replace('option-', '');
          if (!activeFilters.options[optionName]) activeFilters.options[optionName] = [];
          updateFilterArray(activeFilters.options[optionName], val, checked);
        } else if (name.startsWith('metafield-')) {
          const metafieldKey = name.replace('metafield-', '');
          if (!activeFilters.metafields[metafieldKey]) activeFilters.metafields[metafieldKey] = [];
          updateFilterArray(activeFilters.metafields[metafieldKey], val, checked);
        }

        // Fetch storefront updates in real-time (instant changes on desktop)
        fetchAndRenderData();
      });
    });
  }

  function updateFilterArray(arr, value, checked) {
    if (checked) {
      if (!arr.includes(value)) arr.push(value);
    } else {
      const idx = arr.indexOf(value);
      if (idx > -1) arr.splice(idx, 1);
    }
  }

  function clearAllFilters() {
    activeFilters = {
      vendors: [],
      types: [],
      tags: [],
      titles: [],
      collections: [],
      options: {},
      metafields: {},
      availability: [],
      priceRanges: [],
      minPrice: 0,
      maxPrice: 999999,
      sortBy: activeFilters.sortBy,
      page: 1
    };

    fetchAndRenderData();
    closeSidebar();
  }

  function clearGroupFilter(type, key) {
    if (type === 'vendor') activeFilters.vendors = [];
    else if (type === 'product_type') activeFilters.types = [];
    else if (type === 'collection') activeFilters.collections = [];
    else if (type === 'tag' || type === 'tags') activeFilters.tags = [];
    else if (type === 'availability') activeFilters.availability = [];
    else if (type === 'title') activeFilters.titles = [];
    else if (type === 'price') {
      activeFilters.minPrice = 0;
      activeFilters.maxPrice = 999999;
      activeFilters.priceRanges = [];
    }
    else if (type === 'option') {
      activeFilters.options[key] = [];
    }
    else if (type === 'metafield') {
      activeFilters.metafields[key] = [];
    }
    activeFilters.page = 1;
    fetchAndRenderData();
  }

  function removeFilter(type, val) {
    if (type === 'price') {
      activeFilters.minPrice = 0;
      activeFilters.maxPrice = 999999;
      activeFilters.priceRanges = [];
    } else if (type === 'vendor') {
      activeFilters.vendors = activeFilters.vendors.filter(x => x !== val);
    } else if (type === 'type') {
      activeFilters.types = activeFilters.types.filter(x => x !== val);
    } else if (type === 'tag') {
      activeFilters.tags = activeFilters.tags.filter(x => x !== val);
    } else if (type === 'title') {
      activeFilters.titles = activeFilters.titles.filter(x => x !== val);
    } else if (type === 'collection') {
      activeFilters.collections = activeFilters.collections.filter(x => x !== val);
    } else if (type === 'availability') {
      activeFilters.availability = activeFilters.availability.filter(x => x !== val);
    } else if (type.startsWith('option-')) {
      const k = type.replace('option-', '');
      activeFilters.options[k] = activeFilters.options[k].filter(x => x !== val);
    } else if (type.startsWith('metafield-')) {
      const k = type.replace('metafield-', '');
      activeFilters.metafields[k] = activeFilters.metafields[k].filter(x => x !== val);
    }
    activeFilters.page = 1;
    fetchAndRenderData();
  }

  function renderBreadcrumbs() {
    const breadcrumbs = document.getElementById('cfp-breadcrumbs');
    if (!breadcrumbs) return;

    if (globalSettings && globalSettings.showAttributeBasedBreadcrumb === false) {
      breadcrumbs.style.display = 'none';
      breadcrumbs.innerHTML = '';
      return;
    }

    let chipsHTML = '';
    let hasFilters = false;

    const addChip = (label, type, val) => {
      hasFilters = true;
      chipsHTML += `<span class="cfp-breadcrumb-chip" data-type="${type}" data-val="${val}">${label} <button class="cfp-breadcrumb-remove">&times;</button></span>`;
    };

    const getCleanLabel = (type, val) => {
      if (!cfpLastSettings || cfpLastSettings.length === 0) return { label: type.charAt(0).toUpperCase() + type.slice(1), cleanVal: val };
      
      let group = null;
      if (type === 'tag') {
        group = cfpLastSettings.find(s => (s.filterType === 'tag' || s.filterType === 'tags') && s.config && s.config.prefix && val.toLowerCase().startsWith(s.config.prefix.toLowerCase()));
      } else if (type.startsWith('option-')) {
        group = cfpLastSettings.find(s => s.filterType === 'option' && s.filterKey === type.replace('option-', ''));
      } else if (type.startsWith('metafield-')) {
        group = cfpLastSettings.find(s => s.filterType === 'metafield' && s.filterKey === type.replace('metafield-', ''));
      }

      let label = group ? group.label : (type.startsWith('option-') ? type.replace('option-', '') : type.charAt(0).toUpperCase() + type.slice(1));
      let cleanVal = val;
      if (group && group.config && group.config.prefix) {
        const pref = group.config.prefix;
        if (val.toLowerCase().startsWith(pref.toLowerCase())) {
           cleanVal = val.slice(pref.length);
        }
      }
      return { label, cleanVal };
    };

    activeFilters.vendors.forEach(v => addChip(v, 'vendor', v));
    activeFilters.types.forEach(v => addChip(v, 'type', v));
    
    activeFilters.tags.forEach(v => {
      const { label, cleanVal } = getCleanLabel('tag', v);
      addChip(cleanVal, 'tag', v);
    });
    
    (activeFilters.titles || []).forEach(v => addChip(v, 'title', v));
    activeFilters.collections.forEach(v => addChip(v, 'collection', v));
    activeFilters.availability.forEach(v => addChip(v.replace('_', ' '), 'availability', v));
    
    Object.keys(activeFilters.options).forEach(k => {
      activeFilters.options[k].forEach(v => {
        const { label, cleanVal } = getCleanLabel(`option-${k}`, v);
        addChip(cleanVal, `option-${k}`, v);
      });
    });
    
    Object.keys(activeFilters.metafields).forEach(k => {
      activeFilters.metafields[k].forEach(v => addChip(`${k.split('.')[1] || k}: ${v}`, `metafield-${k}`, v));
    });

    if (activeFilters.minPrice > 0 || activeFilters.maxPrice < 999999) {
      const rate = getGlobalCurrencyRate();
      const symbol = getGlobalCurrencySymbol();
      const displayMaxRaw = activeFilters.maxPrice === 999999 ? maxPriceLimit : activeFilters.maxPrice;
      const minVal = Math.round(activeFilters.minPrice * rate);
      const maxVal = Math.round(displayMaxRaw * rate);
      addChip(`${symbol}${minVal} - ${symbol}${maxVal}`, 'price', 'range');
    }

    if (hasFilters) {
      chipsHTML += `<span class="cfp-breadcrumb-clear" style="cursor:pointer; font-size:13px; text-decoration:underline; margin-left:10px;">Clear All</span>`;
      breadcrumbs.innerHTML = chipsHTML;
      breadcrumbs.style.display = 'flex';

      // Attach events
      breadcrumbs.querySelectorAll('.cfp-breadcrumb-chip').forEach(chip => {
        chip.querySelector('.cfp-breadcrumb-remove').addEventListener('click', () => {
          const t = chip.getAttribute('data-type');
          const v = chip.getAttribute('data-val');
          removeFilter(t, v);
        });
      });
      
      const clearBtn = breadcrumbs.querySelector('.cfp-breadcrumb-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', clearAllFilters);
      }
    } else {
      breadcrumbs.style.display = 'none';
      breadcrumbs.innerHTML = '';
    }
  }

  function updateActiveCountBadge() {
    let count = 0;
    count += activeFilters.vendors.length;
    count += activeFilters.types.length;
    count += activeFilters.tags.length;
    count += (activeFilters.titles || []).length;
    count += activeFilters.collections.length;
    count += activeFilters.availability.length;
    
    Object.values(activeFilters.options).forEach(arr => count += arr.length);
    Object.values(activeFilters.metafields).forEach(arr => count += arr.length);

    if (activeFilters.minPrice > 0) count++;
    if (activeFilters.maxPrice < maxPriceLimit) count++;

    if (activeCount) {
      activeCount.textContent = count;
      activeCount.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  }

  function openSidebar() {
    sidebar.classList.add('cfp-sidebar--open');
    if (overlay) overlay.classList.add('cfp-overlay--visible');
    if (sidebar) sidebar.setAttribute('aria-hidden', 'false');
    if (triggerBtn) triggerBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('cfp-sidebar--open');
    if (overlay) overlay.classList.remove('cfp-overlay--visible');
    if (sidebar) sidebar.setAttribute('aria-hidden', 'true');
    if (triggerBtn) triggerBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  // â”€â”€ 8. Independent App Block Injection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let isAttached = false;

  function findAndInject() {
    if (!sidebar) return; // Wait until UI is rendered
    if (isAttached && document.contains(sidebar.parentElement)) return;

    // Look ONLY for our designated app container placed via Theme Editor
    const container = document.querySelector('.cfp-v1-app-container');
    if (container) {
      // Insert layout wrapper
      const wrapper = document.querySelector('.cfp-layout-wrapper') || document.createElement('div');
      if (!wrapper.classList.contains('cfp-layout-wrapper')) {
        wrapper.className = 'cfp-layout-wrapper';
        if (window.cfpFullWidth) {
          wrapper.classList.add('cfp-full-width-mode');
        }
        container.appendChild(wrapper);
        
        // Expand the theme's native container if Full Width is enabled
        if (window.cfpFullWidth) {
           const themeContainer = wrapper.closest('.page-width, .container, .wrapper, .site-wrapper');
           if (themeContainer) {
              themeContainer.style.maxWidth = '100%';
              themeContainer.style.padding = window.innerWidth <= 768 ? '0 15px' : '0 40px';
           }
        }
      }

      // Move the Search Header above the wrapper if it exists in the container
      const pageHeader = document.querySelector('.cfp-page-header');
      if (pageHeader && wrapper.parentElement && pageHeader.parentElement !== wrapper.parentElement) {
        wrapper.parentElement.insertBefore(pageHeader, wrapper);
      }

      const breadcrumbs = document.getElementById('cfp-breadcrumbs');

      if (topBar) {
        wrapper.appendChild(topBar);
        topBar.style.display = 'flex';
      }
      if (breadcrumbs) {
        sidebar.insertBefore(breadcrumbs, sidebar.querySelector('.cfp-sidebar__body'));
        breadcrumbs.style.padding = '15px 20px 0';
        breadcrumbs.style.marginBottom = '0';
      }
      wrapper.appendChild(sidebar);

      // Move products container into wrapper if it already exists
      const productsContainer = document.getElementById('cfp-products-container');
      if (productsContainer) {
        wrapper.appendChild(productsContainer);
      }
      
      sidebar.style.display = 'flex';
      isAttached = true;
    }
  }

  const observer = new MutationObserver(findAndInject);
  observer.observe(document.body, { childList: true, subtree: true });
  findAndInject();

  // Run initial loading
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

