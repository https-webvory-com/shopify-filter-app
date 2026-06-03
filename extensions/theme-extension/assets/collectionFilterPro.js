/**
 * Collection Filter Pro — Storefront JavaScript
 * Dynamic UI Injection and Relative App Proxy Querying
 */ 

(function () {
  'use strict';
 
  const sidebar = document.getElementById('cfp-sidebar');
  const topBar = document.getElementById('cfp-top-bar');
  const overlay = document.getElementById('cfp-overlay');
  const triggerBtn = document.getElementById('cfp-trigger-btn');
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

  // ── 1. Global Filter State ──────────────────────────────────────────
  const PAGE_SIZE = 24;

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
    maxPrice: 9999,
    sortBy: 'created-descending',
    page: 1
  };

  let maxPriceLimit = 1000; // Updated dynamically from product prices

  // ── 2. Initialization ───────────────────────────────────────────────
  let activeMerchandisingRule = null;

  async function init() {
    setupStaticEventListeners();
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

  // ── 3. Fetch data from Shopify App Proxy ───────────────────────────
  async function fetchAndRenderData() {
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

      // Add loading state to sidebar
      sidebar.classList.add('cfp-loading');

      const response = await fetch(`/apps/collection-filter-pro/api/filter?${queryParams.toString()}`);
      const data = await response.json();

      sidebar.classList.remove('cfp-loading');

      if (data.products) {
        renderProducts(data.products, data.totalCount);
      }
      if (data.settings && data.facets) {
        renderFilterSidebar(data.settings, data.facets);
      }
      updateActiveCountBadge();

    } catch (e) {
      console.error("CFP: API Query error", e);
      sidebar.classList.remove('cfp-loading');
    }
  }

  // ── 4. Render Products Grid ────────────────────────────────────────
  function renderProducts(products, totalCount) {
    const grid = findGrid();
    if (!grid) return;

    // Update count labels
    const countLabel = document.querySelector('.cfp-product-count');
    if (countLabel) {
      countLabel.textContent = `${totalCount} product${totalCount === 1 ? '' : 's'}`;
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

    grid.innerHTML = products.map(product => {
      const primaryImg = product.merchandisingImage || product.images?.[0] || 'https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_600x.gif';
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
    renderPagination(grid, totalCount);
  }

  function renderPagination(grid, totalCount) {
    const existing = document.getElementById('cfp-pagination');
    if (existing) existing.remove();

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    if (totalPages <= 1) return;

    const pagination = document.createElement('div');
    pagination.id = 'cfp-pagination';
    pagination.className = 'cfp-pagination';
    pagination.innerHTML = `
      <button class="cfp-pagination__button" data-direction="prev" ${activeFilters.page <= 1 ? 'disabled' : ''}>
        Previous
      </button>
      <span class="cfp-pagination__label">Page ${activeFilters.page} of ${totalPages}</span>
      <button class="cfp-pagination__button" data-direction="next" ${activeFilters.page >= totalPages ? 'disabled' : ''}>
        Next
      </button>
    `;

    pagination.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-direction]');
      if (!button) return;
      const direction = button.dataset.direction;
      if (direction === 'prev' && activeFilters.page > 1) {
        activeFilters.page -= 1;
        fetchAndRenderData();
      }
      if (direction === 'next' && activeFilters.page < totalPages) {
        activeFilters.page += 1;
        fetchAndRenderData();
      }
    });

    const wrapper = document.querySelector('.cfp-layout-wrapper');
    if (wrapper) {
      wrapper.insertAdjacentElement('afterend', pagination);
    } else {
      grid.insertAdjacentElement('afterend', pagination);
    }
  }

  // ── 5. Render Filters Sidebar dynamically ─────────────────────────
  function renderFilterSidebar(settings, facets) {
    const body = sidebar.querySelector('.cfp-sidebar__body');
    if (!body) return;

    // Cache scroll position
    const scrollTop = body.scrollTop;

    let html = '';

    settings.forEach(setting => {
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
        const prefixStr = s.sliderPrefix || prefix || "$";
        const suffixStr = s.sliderSuffix || "";
        const step = s.sliderStep || 1;
        const maxLimit = parseFloat(s.sliderRange || "10000");
        maxPriceLimit = maxLimit; // Update global for active badge computation if needed

        const fillLeft = (activeFilters.minPrice / maxLimit) * 100;
        let effectiveMax = activeFilters.maxPrice;
        if (effectiveMax === 9999 || effectiveMax > maxLimit) effectiveMax = maxLimit;
        const fillRight = 100 - (effectiveMax / maxLimit) * 100;
        
        groupContent = `
          <div class="cfp-price-range">
            <div class="cfp-price-inputs">
              <div class="cfp-price-input-wrap">
                <label for="cfp-price-min" class="cfp-price-label">Min</label>
                <div class="cfp-price-field">
                  ${s.showInputPrefixSuffix !== false ? `<span class="cfp-price-symbol">${prefixStr}</span>` : ''}
                  <input type="number" id="cfp-price-min" class="cfp-price-input" value="${activeFilters.minPrice}" min="0" step="${step}">
                  ${s.showInputPrefixSuffix !== false ? `<span class="cfp-price-symbol" style="padding-left:4px">${suffixStr}</span>` : ''}
                </div>
              </div>
              <span class="cfp-price-divider">—</span>
              <div class="cfp-price-input-wrap">
                <label for="cfp-price-max" class="cfp-price-label">Max</label>
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
        
        if (items.length === 0) return;

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
        const resolvedMode = (displayMode === "Swatch" && !isColor) ? "List" : displayMode; // Fallback if swatch used on non-color
        
        // Wrapper for Max Height scroll
        const scrollClass = (adv.showMoreType === "Scrollbar" && items.length > 6) ? "cfp-scroll-area" : "";
        const scrollStyle = scrollClass ? `style="max-height: ${adv.maxHeight || '300px'};"` : "";

        // Render based on displayMode
        if (resolvedMode === "Dropdown") {
          groupContent = `
            <select class="cfp-select" name="${inputName}">
              <option value="">Any ${setting.label}</option>
              ${items.map(item => `
                <option value="${item.value}" ${activeArray.includes(item.value) ? 'selected' : ''}>
                  ${prefix}${item.label || item.value} (${item.count})
                </option>
              `).join('')}
            </select>
          `;
        }
        else if (resolvedMode === "Swatch" || (isColor && displayMode === "List")) { // Always default color to Swatch for better UI if not overridden
          groupContent = `
            <div class="${scrollClass}" ${scrollStyle}>
              <div class="cfp-color-grid">
                ${items.map(item => {
                  const colorHex = getColorHex(item.value);
                  const isWhite = item.value.toLowerCase() === 'white';
                  return `
                    <label class="cfp-color-swatch" title="${item.value} (${item.count})">
                      <input type="checkbox" name="${inputName}" value="${item.value}" ${activeArray.includes(item.value) ? 'checked' : ''}>
                      <span class="cfp-swatch-circle" style="background:${colorHex}; ${isWhite ? 'border: 1px solid #ddd;' : ''}"></span>
                      <span class="cfp-swatch-label">${item.value}</span>
                    </label>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        }
        else if (resolvedMode === "Box/Button" || resolvedMode === "Button") {
          groupContent = `
            <div class="${scrollClass}" ${scrollStyle}>
              <div class="cfp-button-grid">
                ${items.map(item => `
                  <label class="cfp-button-chip" title="${item.value} (${item.count})">
                    <input type="checkbox" name="${inputName}" value="${item.value}" ${activeArray.includes(item.value) ? 'checked' : ''}>
                    <span>${prefix}${item.label || item.value}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          `;
        }
        else { // Default: List
          const hasSearch = adv.desktopSearchBox && items.length > 5;
          groupContent = `
            ${hasSearch ? `
              <div class="cfp-search-input-wrap">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" class="cfp-search-input cfp-vendor-search" placeholder="Search ${setting.label}...">
              </div>
            ` : ''}
            <div class="${scrollClass}" ${scrollStyle}>
              ${items.map(item => `
                <label class="cfp-checkbox">
                  <input type="checkbox" name="${inputName}" value="${item.value}" ${activeArray.includes(item.value) ? 'checked' : ''}>
                  <span class="cfp-checkbox__box"></span>
                  <span class="cfp-checkbox__label">${prefix}${item.label || item.value}</span>
                  <span class="cfp-checkbox__count">${item.count}</span>
                </label>
              `).join('')}
            </div>
          `;
        }
      }

      const isCollapsed = adv.desktopCollapsed;
      html += `
        <div class="cfp-group" data-group="${type}-${key || ''}">
          <button class="cfp-group__toggle" aria-expanded="${!isCollapsed}" aria-controls="cfp-group-${type}-${key || ''}">
            <span>${setting.label}</span>
            <svg class="cfp-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="cfp-group__content ${isCollapsed ? 'cfp-collapsed' : ''}" id="cfp-group-${type}-${key || ''}">
            ${groupContent}
          </div>
        </div>
      `;
    });

    body.innerHTML = html;
    body.scrollTop = scrollTop;

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
      });
    });
  }

  function setupDynamicFieldListeners() {
    // Brand search input
    const vendorSearch = sidebar.querySelector('.cfp-vendor-search');
    if (vendorSearch) {
      vendorSearch.addEventListener('input', () => {
        const q = vendorSearch.value.toLowerCase().trim();
        const wrapper = vendorSearch.closest('.cfp-group');
        wrapper.querySelectorAll('.cfp-checkbox').forEach(label => {
          const txt = label.querySelector('.cfp-checkbox__label');
          label.style.display = (!txt || txt.textContent.toLowerCase().includes(q)) ? '' : 'none';
        });
      });
    }

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

        if (window.innerWidth > 991) {
          fetchAndRenderData();
        }
      });
    });

    // Checkboxes change listeners
    sidebar.querySelectorAll('.cfp-sidebar__body input[type="checkbox"]').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        const name = checkbox.name;
        const val = checkbox.value;
        const checked = checkbox.checked;

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
          updateFilterArray(activeFilters.tags, val, checked);
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
        if (window.innerWidth > 991) {
          fetchAndRenderData();
        }
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
      maxPrice: 9999,
      sortBy: activeFilters.sortBy,
      page: 1
    };

    fetchAndRenderData();
    closeSidebar();
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
  const gridSelectors = [
    '#product-grid', '#CollectionProductGrid', '.product-grid', '.collection-grid',
    '.main-collection-grid', 'ul.grid', '.grid--view-items', '.boost-pfs-filter-products',
    '#js-product-grid', '.products-grid', '.collection-products', '.product-list'
  ];

  let isAttached = false;

  function findGrid() {
    for (let i = 0; i < gridSelectors.length; i++) {
      const found = document.querySelector(gridSelectors[i]);
      if (found && found.offsetHeight > 50 && !found.closest('.cfp-sidebar')) {
        return found;
      }
    }
    return null;
  }

  function findAndInject() {
    if (isAttached && document.contains(sidebar.parentElement)) return;

    const grid = findGrid();
    if (grid) {
      // Hide theme filters
      const hideSelectors = ['.facets', '.facets-container', '.facets-wrapper', '.collection-filters', 'facet-filters-form', '.product-count', '.pagination', 'nav.pagination', '.page-list', '.page-links', '.pagination-wrapper', '.pagination__nav'];
      hideSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => el.style.setProperty('display', 'none', 'important'));
      });

      // Insert layout wrapper
      const wrapper = document.querySelector('.cfp-layout-wrapper') || document.createElement('div');
      if (!wrapper.classList.contains('cfp-layout-wrapper')) {
        wrapper.className = 'cfp-layout-wrapper';
        grid.parentElement.insertBefore(wrapper, grid);
      }

      if (topBar) {
        wrapper.appendChild(topBar);
        topBar.style.display = 'flex';
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
