/**
 * Collection Filter Pro — Storefront JavaScript
 * Dynamic UI Injection and Relative App Proxy Querying
 */ 

(function () {
  'use strict';
  const customSettings = window.collectionFilterProSettings || {};
 
  const sidebar = document.getElementById('cfp-sidebar');
  const topBar = document.getElementById('cfp-top-bar');
  const overlay = document.getElementById('cfp-overlay');
  const triggerBtn = document.getElementById('cfp-drawer-trigger-btn');
  const closeBtn = document.getElementById('cfp-close-btn');
  const applyBtn = document.getElementById('cfp-apply-btn');
  const clearBtn = document.getElementById('cfp-clear-btn');
  const activeCount = document.getElementById('cfp-active-count');

  if (!sidebar) return;

  const shop = sidebar.dataset.shop;
  const collectionId = sidebar.dataset.collectionId || '';
  const collectionHandle = sidebar.dataset.collectionHandle || '';
  const templateName = sidebar.dataset.templateName || '';
  const searchTerms = sidebar.dataset.searchTerms || '';

  console.log("check againg yyy")

  // ── 1. Global Filter State ──────────────────────────────────────────
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
    sortBy: 'created-descending',
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

    if (activeFilters.sortBy && activeFilters.sortBy !== 'created-descending') params.set('sortBy', activeFilters.sortBy);
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


  // ── 2. Initialization ───────────────────────────────────────────────
  let activeMerchandisingRule = null;

    async function init() {
    setupStaticEventListeners();
    const grid = findGrid();
    if (grid) renderSkeleton(grid);
    await fetchMerchandisingRule();
    await fetchAndRenderData();
  }

  // ── 2.5 Fetch Merchandising Rule ──────────────────────────────────
  async function fetchMerchandisingRule() {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('shop', shop);
      
      if (window.cfpCustomerTags) {
        queryParams.append('customer_tags', window.cfpCustomerTags);
      }

      if (collectionHandle) {
        queryParams.append('collectionHandle', collectionHandle);
      } else if (collectionId) {
        queryParams.append('collectionId', collectionId);
      }

      const response = await fetch(`/apps/collection-filter-pro/api/merchandising?${queryParams.toString()}`);
      const data = await response.json();
      
      if (data && data.rule) {
        activeMerchandisingRule = data.rule;
        console.log("CFP: Active Merchandising Rule loaded", activeMerchandisingRule);
        // You can use activeMerchandisingRule here to render banners or badges
      }
    } catch (e) {
      console.error("CFP: Merchandising API error", e);
    }
  }

  // ── 3. Fetch data from Shopify App Proxy ──────────────────────────────
  
  async function fetchAndRenderData(isLoadMore = false) {
      syncStateToURL(); // Sync URL

    if (window._cfpInitialized && globalSettings && globalSettings.scrollUpOnFilterValuesChange && !globalSettings.horizontalFilters) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    try {
      const queryParams = new URLSearchParams();
      queryParams.append('shop', shop);
      
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
          const grid = findGrid();
          if (grid) renderSkeleton(grid);
        }
        const response = await fetch(`/apps/collection-filter-pro/api/filter?${queryParams.toString()}`);
      const data = await response.json();

      sidebar.classList.remove('cfp-loading');

      if (data.globalSettings) {
        globalSettings = data.globalSettings;
        applyGlobalSettings(globalSettings);
      }
      
      if (data.products) {
        renderProducts(data.products, data.totalCount, isLoadMore);
      }
      if (data.settings && data.facets) {
        cfpLastSettings = data.settings;
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

  // ── 4. Render Products Grid ────────────────────────────────────────

  function renderSkeleton(grid) {
    if (!grid) return;
    let skeletonHtml = '';
    for (let i = 0; i < 8; i++) {
      skeletonHtml += `
        <div class="cfp-skeleton-card">
          <div class="cfp-skeleton cfp-skeleton-image"></div>
          <div style="text-align: center; padding-top: 8px;">
            <div class="cfp-skeleton cfp-skeleton-text cfp-skeleton-vendor"></div>
            <div class="cfp-skeleton cfp-skeleton-title"></div>
            <div class="cfp-skeleton cfp-skeleton-text cfp-skeleton-price"></div>
          </div>
        </div>
      `;
    }
    grid.classList.add('cfp-products-grid');
    grid.innerHTML = skeletonHtml;
    // hide pagination if exists during loading
    const oldPagination = document.querySelector('.cfp-load-more-container');
    if (oldPagination) oldPagination.style.display = 'none';
    
    document.documentElement.classList.remove('cfp-loading-init');
  }

  function renderProducts(products, totalCount, isLoadMore) {
    const grid = findGrid();
    if (!grid) return;

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
      grid.innerHTML = `
        <div class="cfp-no-products">
          <p>No products match your selected filters.</p>
          <button class="cfp-btn cfp-btn--primary" id="cfp-reset-inline">Reset Filters</button>
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
        if (activeFilters.options && Object.keys(activeFilters.options).length > 0) {
          const selectedValues = [];
          Object.values(activeFilters.options).forEach(arr => selectedValues.push(...arr));
          
          if (selectedValues.length > 0 && product.variants && product.variants.length > 0) {
            // Find a variant that matches one of the selected option values
            const matchedVariant = product.variants.find(v => 
              (v.option1 && selectedValues.includes(v.option1)) ||
              (v.option2 && selectedValues.includes(v.option2)) ||
              (v.option3 && selectedValues.includes(v.option3))
            );
            if (matchedVariant && matchedVariant.imageUrl) {
              variantImg = matchedVariant.imageUrl;
            }
          }
        }
  
        const primaryImg = variantImg || product.merchandisingImage || product.images?.[0] || 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_600x.gif';
      const secondaryImg = (product.merchandisingImage && product.images?.[0] && product.images?.[0] !== product.merchandisingImage) ? product.images[0] : (product.images?.[1] || primaryImg);
      const price = parseFloat(product.priceMin).toFixed(2);
      const comparePrice = product.variants?.[0]?.compareAtPrice 
        ? parseFloat(product.variants[0].compareAtPrice).toFixed(2) 
        : null;

      const onSale = comparePrice && parseFloat(comparePrice) > parseFloat(price);

      return `
        <div class="cfp-product-card">
          <a href="/products/${product.handle}" class="cfp-product-card__link">
            <div class="cfp-product-card__image-container">
              <img src="${primaryImg}" alt="${product.title}" class="cfp-product-card__image cfp-product-card__image--primary" loading="lazy" />
              <img src="${secondaryImg}" alt="${product.title}" class="cfp-product-card__image cfp-product-card__image--secondary" loading="lazy" />
              ${onSale ? '<span class="cfp-product-card__badge">Sale</span>' : ''}
            </div>
            <div class="cfp-product-card__info">
              <span class="cfp-product-card__vendor">${product.vendor}</span>
              <h3 class="cfp-product-card__title">${product.title}</h3>
              <div class="cfp-product-card__price-row">
                <span class="cfp-product-card__price">$${price}</span>
                ${onSale ? `<span class="cfp-product-card__compare-price">$${comparePrice}</span>` : ''}
              </div>
            </div>
          </a>
        </div>
      `;
    }).join('');
    
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
      <div class="cfp-progress-bar-container" style="width: 250px; height: 4px; background: #e0e0e0; margin-bottom: 20px; border-radius: 2px; overflow: hidden;">
        <div class="cfp-progress-bar" style="width: ${percentage}%; height: 100%; background: #008060; transition: width 0.3s ease;"></div>
      </div>
      <button class="cfp-btn cfp-btn--primary" id="cfp-load-more-btn" style="padding: 12px 40px; font-weight: bold; letter-spacing: 1px; cursor: pointer;">
        LOAD MORE
      </button>
    `;

    pagination.querySelector('#cfp-load-more-btn').addEventListener('click', () => {
      activeFilters.page += 1;
      fetchAndRenderData(true);
    });

    grid.appendChild(pagination);
  }

  // ── 5. Render Filters Sidebar dynamically ──────────────────────────────
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
        const prefixStr = s.sliderPrefix || (setting.type === "price_range" ? "$" : "");
        const suffixStr = s.sliderSuffix || "";
        const step = s.sliderStep || 1;
        // Calculate max price from priceRanges
        let maxLimit = 100000;
        if (facets && facets.priceRanges && facets.priceRanges.length > 0) {
          const maxValues = facets.priceRanges.map(r => {
            const parts = r.label ? r.label.split('-') : [];
            return parts.length === 2 ? parseFloat(parts[1]) : 0;
          });
          const highest = Math.max(...maxValues);
          if (highest > 0) maxLimit = highest;
        }

        maxPriceLimit = maxLimit; // Update global for active badge computation if needed

        const fillLeft = (activeFilters.minPrice / maxLimit) * 100;
        let effectiveMax = activeFilters.maxPrice;
        if (effectiveMax === 999999 || effectiveMax > maxLimit) effectiveMax = maxLimit;
        const fillRight = 100 - (effectiveMax / maxLimit) * 100;
        
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
          const val = (i / (points - 1)) * maxLimit;
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
                  <input type="number" id="cfp-price-min" class="cfp-price-input" value="${activeFilters.minPrice}" min="0" step="${step}">
                  ${s.showInputPrefixSuffix !== false ? `<span class="cfp-price-symbol" style="padding-left:4px">${suffixStr}</span>` : ''}
                </div>
              </div>
              <span class="cfp-price-divider">-</span>
              <div class="cfp-price-input-wrap">
                <div class="cfp-price-field">
                  ${s.showInputPrefixSuffix !== false ? `<span class="cfp-price-symbol">${prefixStr}</span>` : ''}
                  <input type="number" id="cfp-price-max" class="cfp-price-input" value="${effectiveMax}" min="0" step="${step}">
                  ${s.showInputPrefixSuffix !== false ? `<span class="cfp-price-symbol" style="padding-left:4px">${suffixStr}</span>` : ''}
                </div>
              </div>
            </div>
            
            <div class="cfp-range-track" id="cfp-slider-track">
              <div class="cfp-range-fill" id="cfp-slider-fill" style="left: ${fillLeft}%; right: ${fillRight}%;"></div>
              <input type="range" class="cfp-range-input" id="cfp-slider-range-min" min="0" max="${maxLimit}" value="${activeFilters.minPrice}" step="${step}">
              <input type="range" class="cfp-range-input" id="cfp-slider-range-max" min="0" max="${maxLimit}" value="${effectiveMax}" step="${step}">
              ${ticksHtml}
            </div>
          </div>
        `;
      } 
      else {
        // Resolve dynamic items
        let items = [];
        if (type === 'price') {
          items = (facets.priceRanges || []).map(r => {
            const minStr = r.min !== undefined ? r.min : (r.from || "");
            const maxStr = r.max !== undefined ? r.max : (r.to || "");
            let parsedLabel = (r.label || "").replace("{0}", minStr);
            parsedLabel = parsedLabel.replace("{1}", maxStr);
            return {
              value: `${minStr}-${maxStr}`,
              label: parsedLabel,
              count: r.count
            };
          });
        }
        else if (type === 'vendor') items = facets.vendors || [];
        else if (type === 'product_type') items = facets.productTypes || [];
        else if (type === 'collection') items = facets.collections || [];
        else if (type === 'tag' || type === 'tags') items = facets.tags || [];
        else if (type === 'title') items = facets.titles || [];
        else if (type === 'option') items = facets.options?.[key] || [];
        else if (type === 'metafield') items = facets.metafields?.[key] || [];

        if (!items || items.length === 0) return;

        // Apply advanced exclusions and manual sorts
        if (config.excludedValues && config.excludedValues.length > 0) {
          items = items.filter(i => !config.excludedValues.includes(i.value));
        }
        if (config.useManualValues && config.manualValues && config.manualValues.length > 0) {
          items = items.filter(i => config.manualValues.includes(i.value));
          if (config.sortManualValues) {
            items.sort((a,b) => config.manualValues.indexOf(a.value) - config.manualValues.indexOf(b.value));
          }
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


        const activeArray = (type === 'vendor') ? activeFilters.vendors :
                            (type === 'product_type') ? activeFilters.types :
                            (type === 'collection') ? activeFilters.collections :
                            (type === 'tag' || type === 'tags') ? activeFilters.tags :
                            (type === 'price') ? activeFilters.priceRanges :
                            (type === 'title') ? (activeFilters.titles || []) :
                            (type === 'option') ? (activeFilters.options[key] || []) :
                            (activeFilters.metafields[key] || []);

        const inputName = (type === 'option') ? `option-${key}` : 
                          (type === 'metafield') ? `metafield-${key}` : type;

        const isColor = type === 'option' && (key.toLowerCase().includes('color') || key.toLowerCase().includes('colour'));
        const resolvedMode = displayMode;
        
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
          const showLabel = swatchConf.showLabel === true;
          const hasSearch = adv.desktopSearchBox;

          groupContent = `
            ${hasSearch ? `
              <div class="cfp-search-input-wrap">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" class="cfp-search-input cfp-vendor-search" placeholder="Search ${setting.label}...">
              </div>
            ` : ''}
            <div class="${scrollClass}" ${scrollStyle}>
              <div class="cfp-color-grid cfp-color-grid--list">
                ${(() => {
                  let hasAnyImage = false;
                  if (swatchConf.colors) {
                    for (const k in swatchConf.colors) {
                      if (swatchConf.colors[k].type === 'image' && swatchConf.colors[k].value) {
                        hasAnyImage = true;
                        break;
                      }
                    }
                  }
                  
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
                    const bgStyle = isImageItem ? `background: url('${colorValue}') center/cover;` : `background:${colorValue};`;
                    
                    // Check if it's active
                    const isActive = activeArray.includes(item.value) || ((type === 'tag' || type === 'tags') && activeArray.includes(getCleanLabel('tag', item.value).cleanVal));
                    
                    const useImageLayout = hasAnyImage;
                    
                    let visualHtml = '';
                    if (useImageLayout) {
                      if (isImageItem) {
                        visualHtml = `<img src="${colorValue}" alt="${item.value}" style="width: auto; height: 80px; object-fit: contain; margin-bottom: 8px; ${isActive ? 'outline: 2px solid #000; outline-offset: 4px;' : ''}">`;
                      } else {
                        // Empty placeholder if icon is missing but group is image-based. Added &nbsp; to prevent :empty CSS from hiding it.
                        visualHtml = `<div style="width: 100%; height: 80px; background: transparent; margin-bottom: 8px; display: block;">&nbsp;</div>`;
                      }
                    } else {
                      visualHtml = `<span class="cfp-swatch-circle" style="${bgStyle} width: 22px; height: 22px; display: inline-block; ${isCircle ? 'border-radius: 50%;' : 'border-radius: 4px;'} border: 1px solid ${isWhite ? '#ddd' : '#e1e3e5'}; ${isActive ? 'box-shadow: 0 0 0 2px #000;' : ''} flex-shrink: 0;"></span>`;
                    }
                    
                    return `
                      <label class="cfp-color-swatch ${hide ? 'cfp-view-more-hidden' : ''} ${useImageLayout ? 'cfp-swatch-is-image' : ''}" style="${hide ? 'display: none;' : ''} display: flex; align-items: center; gap: ${useImageLayout ? '4px' : '8px'}; cursor: pointer; flex-direction: ${useImageLayout ? 'column' : 'row'}; justify-content: flex-start; text-align: center; width: 100%; box-sizing: border-box;" title="${item.value} ${globalSettings && globalSettings.showProductCount === false ? '' : ` (${item.count})`}">
                        <input type="checkbox" name="${inputName}" value="${item.value}" ${isActive ? 'checked' : ''} style="display:none;">
                        ${visualHtml}
                        ${showLabel || useImageLayout ? `<span class="cfp-swatch-label" style="font-family: 'Montserrat', 'Poppins', 'Inter', sans-serif; font-size: ${useImageLayout ? '14px' : '15px'}; text-align: ${useImageLayout ? 'center' : 'left'}; color: #202223;">${getDisplayLabel(item.value, prefix)}</span>` : `<span class="cfp-swatch-label" style="display:none;">${getDisplayLabel(item.value, prefix)}</span>`}
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
                <input type="text" class="cfp-search-input cfp-vendor-search" placeholder="Search ${setting.label}...">
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
                <input type="text" class="cfp-search-input cfp-vendor-search" placeholder="Search ${setting.label}...">
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
              ${adv.displayTooltip ? `
                <div class="cfp-tooltip-icon" data-tooltip="${(adv.tooltipContent || '').replace(/"/g, '&quot;')}">?</div>
              ` : ''}
            </div>
            <svg class="cfp-chevron" viewBox="0 0 20 20" style="width: 12px; height: 12px; fill: currentColor;"><path d="M5 8l5 5 5-5z" /></svg>
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

  // ── 6. Utility: CSS Color mapper ────────────────────────────────────
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

  // ── 7. Setup Interactivity Listeners ─────────────────────────────────
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
        
        // Filter list items
        wrapper.querySelectorAll('.cfp-checkbox').forEach(label => {
          const txt = label.querySelector('.cfp-checkbox__label');
          label.style.display = (!txt || txt.textContent.toLowerCase().includes(q)) ? '' : 'none';
        });
        
        // Filter button chips
        wrapper.querySelectorAll('.cfp-button-chip').forEach(label => {
          const txt = label.querySelector('span');
          label.style.display = (!txt || txt.textContent.toLowerCase().includes(q)) ? '' : 'none';
        });
        
        // Filter swatches
        wrapper.querySelectorAll('.cfp-color-swatch').forEach(label => {
          const txt = label.querySelector('.cfp-swatch-label') || label;
          label.style.display = (!txt || txt.title.toLowerCase().includes(q) || txt.textContent.toLowerCase().includes(q)) ? '' : 'none';
        });
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
      const maxLimit = parseFloat(rangeMin.max) || 1000;
      
      let leftPercent = (minVal / maxLimit) * 100;
      let rightPercent = 100 - (maxVal / maxLimit) * 100;
      if(leftPercent < 0) leftPercent = 0;
      if(rightPercent < 0) rightPercent = 0;
      if(leftPercent > 100) leftPercent = 100;
      if(rightPercent > 100) rightPercent = 100;
      
      fill.style.left = `${leftPercent}%`;
      fill.style.right = `${rightPercent}%`;
    }

    if (minInput && maxInput) {
      const applyPriceFilter = () => {
        let minV = parseFloat(minInput.value) || 0;
        let maxV = parseFloat(maxInput.value) || 999999;
        if(minV > maxV) { let t=minV; minV=maxV; maxV=t; minInput.value=minV; maxInput.value=maxV; }
        activeFilters.minPrice = minV;
        activeFilters.maxPrice = maxV;
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
        activeFilters.minPrice = parseFloat(rangeMin.value);
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
        activeFilters.maxPrice = parseFloat(rangeMax.value);
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
        else if (name === 'type') arr = activeFilters.types;
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
            if (cb !== checkbox) cb.checked = false;
          });
          if (name === 'availability') activeFilters.availability = [];
          else if (name === 'vendor') activeFilters.vendors = [];
          else if (name === 'type') activeFilters.types = [];
          else if (name === 'collection') activeFilters.collections = [];
          else if (name === 'tag' || name === 'tags') activeFilters.tags = [];
          else if (name === 'price') activeFilters.priceRanges = [];
          else if (name === 'title') activeFilters.titles = [];
          else if (name.startsWith('option-')) {
            const optionName = name.replace('option-', '');
            activeFilters.options[optionName] = [];
          }
          else if (name.startsWith('metafield-')) {
            const metafieldKey = name.replace('metafield-', '');
            activeFilters.metafields[metafieldKey] = [];
          }
        }

        activeFilters.page = 1;

        if (name === 'availability') {
          updateFilterArray(activeFilters.availability, val, checked);
        } else if (name === 'vendor') {
          updateFilterArray(activeFilters.vendors, val, checked);
        } else if (name === 'type') {
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
      addChip(`${activeFilters.minPrice} - ${activeFilters.maxPrice}`, 'price', 'range');
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
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('cfp-sidebar--open');
    if (overlay) overlay.classList.remove('cfp-overlay--visible');
    document.body.style.overflow = '';
  }

  // ── 8. Find grid elements on Dawn and other standard themes ──────────
  const gridSelectors = customSettings.gridSelectors || [
    '#product-grid', '#CollectionProductGrid', '.product-grid', '.collection-grid',
    '.main-collection-grid', 'ul.grid', '.grid--view-items', '.boost-pfs-filter-products',
    '#js-product-grid', '.products-grid', '.collection-products', '.product-list', '[data-product-grid]'
  ];

  let isAttached = false;

  function findGrid() {
    for (let i = 0; i < gridSelectors.length; i++) {
      const found = document.querySelector(gridSelectors[i]);
      if (found && !found.closest('.cfp-sidebar')) {
        return found;
      }
    }
    
    let fallback = document.getElementById('cfp-fallback-grid');
    if (!fallback) {
      fallback = document.createElement('div');
      fallback.id = 'cfp-fallback-grid';
      fallback.className = 'cfp-products-grid cfp-fallback';
      
      const sidebarEl = document.getElementById('cfp-sidebar');
      if (sidebarEl && sidebarEl.parentElement) {
        sidebarEl.parentElement.insertBefore(fallback, sidebarEl.nextSibling);
      } else {
        const main = document.querySelector('.template-search') || document.querySelector('#MainContent') || document.querySelector('.main-content') || document.body;
        main.appendChild(fallback);
      }
    }
    return fallback;
  }

  function findAndInject() {
    if (isAttached && document.contains(sidebar.parentElement)) return;

    const grid = findGrid();
    if (grid) {
      grid.style.display = 'block';

      const hideSelectors = customSettings.hideSelectors || ['.facets', '.facets-container', '.facets-wrapper', '.collection-filters', 
'facet-filters-form', '.product-count', '.pagination', 'nav.pagination', '.page-list', '.page-links', 
'.pagination-wrapper', '.pagination__nav'];
      hideSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.style.setProperty('display', 'none', 'important'));
      });

      const universalEmptySelectors = [
        '[role="status"]', '.empty-state', '[data-empty-state]', '.search--empty', 
        '.template-search__empty-results', '.template-search__results--empty', 
        '.collection--empty', '#EmptyState', '.search-results__empty'
      ];
      universalEmptySelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.style.setProperty('display', 'none', 'important'));
      });

      // Insert layout wrapper
      const wrapper = document.querySelector('.cfp-layout-wrapper') || document.createElement('div');
      if (!wrapper.classList.contains('cfp-layout-wrapper')) {
        wrapper.className = 'cfp-layout-wrapper';
        grid.parentElement.insertBefore(wrapper, grid);
      }

      const breadcrumbs = document.getElementById('cfp-breadcrumbs');

      if (topBar) {
        wrapper.appendChild(topBar);
        topBar.style.display = 'flex';
      }
      if (breadcrumbs) {
        wrapper.appendChild(breadcrumbs);
      }
      wrapper.appendChild(sidebar);
      wrapper.appendChild(grid);
      
      sidebar.style.display = 'flex';
      isAttached = true;
    }
  }

  const observer = new MutationObserver(findAndInject);
  observer.observe(document.body, { childList: true, subtree: true });
  findAndInject();

  // Run initial loading
  init();

})();
