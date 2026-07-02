/**
 * Instant Search Implementation - Full Screen Modal
 * Hijacks the theme's default search input and displays a full-screen search modal.
 */

document.addEventListener("DOMContentLoaded", function () {
  // Config
  const userSettings = window.CFP_InstantSearchSettings || {};
  const CONFIG = {
    minChars: 2,
    debounceTime: 300,
    productLimit: userSettings.productLimit || 6,
    customSelector: userSettings.customTriggerSelector || "",
    apiUrl: "/apps/collection-filter-pro/api/filter",
  };

  const shopDomain = window.Shopify ? window.Shopify.shop : "";

  // UI Elements
  let modal = null;
  let overlay = null;
  let mainInput = null;

  // Initialize
  init();

  function init() {
    injectStyles();
    createUI();
    attachListeners();
  }

  function injectStyles() {
    let style = document.getElementById('cfp-instant-search-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'cfp-instant-search-styles';
      document.head.appendChild(style);
    }
    style.innerHTML = `
      .cfp-skeleton {
        background: #cbd5e1; /* Darker gray so it's clearly visible */
        border-radius: 4px;
        animation: cfp-pulse 1.5s infinite ease-in-out;
      }
      @keyframes cfp-pulse {
        0% { opacity: 1; }
        50% { opacity: 0.4; }
        100% { opacity: 1; }
      }
      .cfp-skeleton-card {
        display: flex;
        flex-direction: column;
        gap: 10px;
        width: 100%;
      }
      .cfp-skeleton-img {
        width: 100%;
        aspect-ratio: 3/4;
        min-height: 200px; /* Fallback for older browsers */
      }
      .cfp-skeleton-text {
        height: 16px;
        width: 80%;
        margin: 4px auto 0;
      }
      .cfp-skeleton-price {
        height: 16px;
        width: 40%;
        margin: 0 auto;
      }
      .cfp-skeleton-collection {
        height: 20px;
        width: 70%;
        margin: 10px 0;
      }
      .cfp-product-swatches {
        display: flex;
        gap: 6px;
        margin-top: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }
      .cfp-swatch-item {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        overflow: visible; /* To allow tooltip overflow */
        border: 1px solid #e2e8f0;
        cursor: pointer;
        padding: 2px;
        background: #fff;
        transition: border-color 0.2s;
        position: relative;
      }
      .cfp-swatch-item:hover, .cfp-swatch-item.cfp-swatch-active {
        border-color: #000;
      }
      .cfp-swatch-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        display: block;
      }
      /* Tooltip container */
      .cfp-swatch-item::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 6px;
        background-color: #4b5563;
        color: #fff;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        white-space: nowrap;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s;
        pointer-events: none;
        z-index: 10;
        font-weight: 500;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
      /* Tooltip arrow */
      .cfp-swatch-item::before {
        content: '';
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        margin-bottom: 2px;
        border-width: 4px;
        border-style: solid;
        border-color: #4b5563 transparent transparent transparent;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s;
        pointer-events: none;
        z-index: 10;
      }
      .cfp-swatch-item:hover::after,
      .cfp-swatch-item:hover::before {
        opacity: 1;
        visibility: visible;
      }
      .cfp-swatch-hidden {
        display: none !important;
      }
      .cfp-swatch-more {
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        color: #64748b;
        cursor: pointer;
        user-select: none;
        margin-left: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  function createUI() {
    // 1. Overlay
    overlay = document.createElement("div");
    overlay.className = "cfp-search-modal-overlay";
    document.body.appendChild(overlay);

    // 2. Modal
    modal = document.createElement("div");
    modal.className = "cfp-search-modal";
    modal.innerHTML = `
      <div class="cfp-search-header">
        <div class="cfp-search-input-wrapper">
          <svg class="cfp-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="cfp-main-search-input" placeholder="Search for..." autocomplete="off" />
          <button id="cfp-search-close" class="cfp-search-close-btn" aria-label="Close search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
      
      <div class="cfp-search-loading-container" id="cfp-search-loading">
        <div class="cfp-search-spinner"></div>
      </div>

      <div class="cfp-search-body" id="cfp-search-body">
        <div class="cfp-search-column-left">
          <div class="cfp-search-product-grid" id="cfp-search-products">
            <!-- Products will be rendered here -->
          </div>

        </div>
        <div class="cfp-search-column-right">
          <div id="cfp-recent-searches-container" style="display: none; margin-bottom: 30px;">
            <ul class="cfp-recent-searches-list" id="cfp-recent-searches-list">
              <!-- Recent searches rendered here -->
            </ul>
          </div>
          <div class="cfp-search-section-title" id="cfp-collections-title">Collections</div>
          <ul class="cfp-search-collections-list" id="cfp-search-collections">
            <!-- Collections will be rendered here -->
          </ul>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    mainInput = document.getElementById("cfp-main-search-input");
  }

  function attachListeners() {
      // 1. Hijack all theme search inputs/icons using a global delegated listener (capture phase)
      // This ensures we catch clicks even if the theme dynamically re-renders the header (e.g. sticky header)
      let defaultSelector = 'input[type="search"], input[name="q"], summary[aria-haspopup="dialog"], .header__search, [href="/search"]';
      if (CONFIG.customSelector) {
          defaultSelector += ', ' + CONFIG.customSelector;
      }
      
      const handleEvent = (e) => {
         // Find if the event target is inside our defaultSelector
         const trigger = e.target.closest ? e.target.closest(defaultSelector) : null;
         if (!trigger) return;
         
         // Ignore clicks inside our own modal to prevent self-closing issues
         if (e.target.closest('#cfp-search-overlay') || e.target.closest('#cfp-instant-search-styles')) return;

         // Only hijack search elements that are inside the header, unless they match the custom selector
         const isHeaderElement = trigger.closest('header') || 
                                 trigger.closest('sticky-header') || 
                                 trigger.closest('.header') || 
                                 trigger.closest('[id*="header"]');
                                 
         const isCustomSelector = CONFIG.customSelector && trigger.matches(CONFIG.customSelector);

         if (!isHeaderElement && trigger.tagName !== 'SUMMARY' && !isCustomSelector) {
           return; // Ignore inputs that are not in the header (e.g. main search page input)
         }

         // Only intercept left clicks for mouse events
         if ((e.type === 'mousedown' || e.type === 'pointerdown') && e.button !== 0) return;
         
         if (e.type === 'keydown' && e.key !== 'Enter') return;

         e.preventDefault();
         e.stopPropagation();
         e.stopImmediatePropagation();
         closeThemeSearch(trigger);
         openModal(trigger);
      };

      ['click', 'mousedown', 'pointerdown', 'touchstart', 'focus', 'keydown'].forEach(eventType => {
          document.addEventListener(eventType, handleEvent, true);
      });

    // 2. Modal Close Listeners
    document.getElementById("cfp-search-close").addEventListener("click", closeModal);
    overlay.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && modal.classList.contains("cfp-open")) {
        closeModal();
      }
    });

    // 3. Main Input Listener
    let debounceTimer;
    mainInput.addEventListener("input", (e) => {
      const query = e.target.value.trim();
      clearTimeout(debounceTimer);

      if (query.length < CONFIG.minChars) {
        document.getElementById("cfp-search-body").classList.remove("cfp-has-results");
        return;
      }

      debounceTimer = setTimeout(() => {
        performSearch(query);
      }, CONFIG.debounceTime);
    });

    // Handle Enter key in our main input
    mainInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const query = e.target.value.trim();
        if (query.length >= CONFIG.minChars) {
          saveRecentSearch(query);
          window.location.href = `/search?q=${encodeURIComponent(query)}`;
        }
      }
    });
  }

  function saveRecentSearch(query) {
    if (!query) return;
    let searches = JSON.parse(localStorage.getItem('cfp_recent_searches') || '[]');
    searches = searches.filter(q => q.toLowerCase() !== query.toLowerCase()); // Remove duplicates
    searches.unshift(query); // Add to beginning
    if (searches.length > 5) searches = searches.slice(0, 5); // Keep only 5
    localStorage.setItem('cfp_recent_searches', JSON.stringify(searches));
  }

  function openModal(triggerElement) {
    // Determine where to place the modal (below the header)
    const header = document.querySelector('header, .header, #shopify-section-header');
    let topPos = 0;
    
    if (header) {
      const rect = header.getBoundingClientRect();
      topPos = rect.bottom;
    } else if (triggerElement) {
      const rect = triggerElement.getBoundingClientRect();
      topPos = rect.bottom;
    }

    modal.style.top = `0px`;

    overlay.classList.add("cfp-open");
    modal.classList.add("cfp-open");
    document.body.style.overflow = "hidden"; // Prevent background scrolling
    document.body.classList.add("cfp-search-active");
    
    // Check if input is empty, if so, load default view
    if (mainInput.value.trim().length === 0) {
      fetchDefaultView();
    }

    // Focus the input after transition
    setTimeout(() => {
      mainInput.focus();
    }, 100);
  }

  function closeModal() {
    overlay.classList.remove("cfp-open");
    modal.classList.remove("cfp-open");
    document.body.style.overflow = "";
    document.body.classList.remove("cfp-search-active");
    closeThemeSearch();
  }

  function closeThemeSearch() {
      // 1. details-based modals
      document.querySelectorAll('details[open]').forEach(details => {
        if (
          details.querySelector('[class*="search" i]') || 
          details.className.toLowerCase().includes('search') ||
          details.id.toLowerCase().includes('search') ||
          details.querySelector('summary[class*="search" i]')
        ) {
          details.removeAttribute('open');
        }
      });
      
      // 2. dialog-based modals
      document.querySelectorAll('dialog[open]').forEach(dialog => {
        if (dialog.className.toLowerCase().includes('search') || dialog.id.toLowerCase().includes('search')) {
          dialog.close();
        }
      });
      
      // 3. active class based modals
      document.querySelectorAll('[class*="search" i].active, [class*="search" i].is-active, [class*="search" i].open, [class*="search" i].is-open, [id*="search" i].active, [id*="search" i].is-active, [id*="search" i].open, [id*="search" i].is-open').forEach(el => {
        if (!el.id.includes('cfp-search')) {
          el.classList.remove('active', 'is-active', 'open', 'is-open');
        }
      });

      // 4. body classes
      document.body.classList.forEach(cls => {
         if (cls.toLowerCase().includes('search') && !cls.includes('cfp-search')) {
            document.body.classList.remove(cls);
         }
      });
      
      // 5. Inline styles (e.g., display: block or opacity: 1) on common search wrappers
      const commonWrappers = document.querySelectorAll('.search-modal, #SearchDrawer, .search-drawer, .header__search, .search-popup, #search-modal, #search-popup');
      commonWrappers.forEach(el => {
          if (!el.id.includes('cfp-search')) {
             if (el.style.display === 'block') el.style.display = '';
             if (el.style.opacity === '1') el.style.opacity = '';
             if (el.style.visibility === 'visible') el.style.visibility = '';
          }
      });
    }

  function renderLoading(isLoading) {
    const loader = document.getElementById("cfp-search-loading");
    const body = document.getElementById("cfp-search-body");
    const productsGrid = document.getElementById("cfp-search-products");
    const collectionsList = document.getElementById("cfp-search-collections");
    
    loader.style.display = "none"; // Hide old spinner entirely
    console.log("CFP: renderLoading called with", isLoading);
    
    if (isLoading) {
      console.log("CFP: Injecting skeletons into productsGrid and collectionsList");
      body.classList.add("cfp-has-results"); // Keep body visible for skeletons
      
      let skeletonProducts = '';
      for(let i=0; i<CONFIG.productLimit; i++) {
        skeletonProducts += `
          <div class="cfp-skeleton-card" style="display: flex; flex-direction: column; gap: 10px; width: 100%;">
            <div class="cfp-skeleton cfp-skeleton-img" style="width: 100%; aspect-ratio: 3/4; min-height: 200px; background: #e2e8f0; border-radius: 4px;">&nbsp;</div>
            <div class="cfp-skeleton cfp-skeleton-text" style="min-height: 16px; width: 80%; background: #e2e8f0; border-radius: 4px; margin: 4px auto 0;">&nbsp;</div>
            <div class="cfp-skeleton cfp-skeleton-price" style="min-height: 16px; width: 40%; background: #e2e8f0; border-radius: 4px; margin: 0 auto;">&nbsp;</div>
          </div>
        `;
      }
      productsGrid.innerHTML = skeletonProducts;

      if (collectionsList) {
        let skeletonCollections = '';
        for(let i=0; i<5; i++) {
          skeletonCollections += `
            <li style="margin-bottom: 15px;">
              <div class="cfp-skeleton cfp-skeleton-collection" style="min-height: 18px; width: 70%; background: #e2e8f0; border-radius: 4px;">&nbsp;</div>
            </li>
          `;
        }
        collectionsList.innerHTML = skeletonCollections;
      }
    }
  }

  async function fetchDefaultView() {
    document.getElementById("cfp-search-body").classList.add("cfp-has-results");
    const cacheKey = `cfp_instant_default_${shopDomain}`;
    const cached = sessionStorage.getItem(cacheKey);
    let hasCachedData = false;

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        renderRecentSearches("");
        renderCollections(parsed.collectionsData, "", true);
        renderProducts(parsed.productsData, "", true);
        hasCachedData = true;
      } catch (e) {}
    }

    if (!hasCachedData) {
      renderLoading(true);
    }

    try {
      // 1. Fetch 4 popular products in background
      const productsPromise = fetch(
        `${CONFIG.apiUrl}?shop=${shopDomain}&limit=${CONFIG.productLimit}&sortBy=best-selling`
      ).then((res) => res.json());

      // 2. Fetch all/popular collections in background
      const rootUrl = window.Shopify && window.Shopify.routes ? window.Shopify.routes.root : "/";
      const collectionsPromise = fetch(`${rootUrl}collections.json?limit=5`)
        .then(res => {
           if(res.ok) return res.json();
           return fetch(`${rootUrl}search/suggest.json?q=a&resources[type]=collection&resources[limit]=5`).then(r => r.json());
        });

      const [productsData, collectionsData] = await Promise.all([
        productsPromise,
        collectionsPromise,
      ]);

      // 3. Update Cache silently
      sessionStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        productsData,
        collectionsData
      }));

      // 4. Update UI with fresh data if user hasn't typed anything yet
      const inputEl = document.getElementById("cfp-main-search-input");
      const currentQuery = inputEl ? inputEl.value : "";
      if (!currentQuery) {
        renderRecentSearches("");
        renderCollections(collectionsData, "", true);
        renderProducts(productsData, "", true);
      }

    } catch (error) {
      console.error("Instant Search Default View Error:", error);
      if (!hasCachedData) {
        document.getElementById("cfp-search-products").innerHTML = 
          `<div class="cfp-search-no-results">Unable to load trending products.</div>`;
        if (document.getElementById("cfp-search-collections")) {
           document.getElementById("cfp-search-collections").innerHTML = "";
        }
      }
    } finally {
      if (!hasCachedData) renderLoading(false);
    }
  }

  function renderRecentSearches(query) {
    const container = document.getElementById("cfp-recent-searches-container");
    const list = document.getElementById("cfp-recent-searches-list");
    const collectionsTitle = document.getElementById("cfp-collections-title");
    
    if (query && query.trim().length > 0) {
      if (container) container.style.display = "none";
      if (collectionsTitle) collectionsTitle.style.display = "block";
      return;
    }

    const searches = JSON.parse(localStorage.getItem('cfp_recent_searches') || '[]');
    if (searches.length === 0) {
      if (container) container.style.display = "none";
      if (collectionsTitle) collectionsTitle.style.display = "block";
      return;
    }

    if (container) container.style.display = "block";
    if (collectionsTitle) collectionsTitle.style.display = "none";

    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <div class="cfp-search-section-title" style="margin-bottom: 0;">Recent Searches</div>
      </div>
    `;
    searches.forEach((s) => {
      html += `
        <li class="cfp-recent-search-item">
          <a href="/search?q=${encodeURIComponent(s)}" class="cfp-recent-search-link">
            <svg class="cfp-history-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            ${s}
          </a>
          <button class="cfp-remove-recent-btn" data-query="${s}" aria-label="Remove search">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </li>
      `;
    });
    if(list) list.innerHTML = html;

    if(list) {
      list.querySelectorAll('.cfp-remove-recent-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const q = btn.getAttribute('data-query');
          removeRecentSearch(q);
        });
      });
    }
  }

  function removeRecentSearch(query) {
    let searches = JSON.parse(localStorage.getItem('cfp_recent_searches') || '[]');
    searches = searches.filter(q => q !== query);
    localStorage.setItem('cfp_recent_searches', JSON.stringify(searches));
    renderRecentSearches("");
  }

  async function performSearch(query) {
    document.getElementById("cfp-search-body").classList.add("cfp-has-results");
    const trimmedQuery = query.trim().toLowerCase();
    
    const cacheKey = `cfp_instant_search_${shopDomain}_${trimmedQuery}`;
    const cached = sessionStorage.getItem(cacheKey);
    let hasCachedData = false;

    renderRecentSearches(query);

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        renderCollections(parsed.collectionsData, query);
        renderProducts(parsed.productsData, query);
        hasCachedData = true;
      } catch (e) {}
    }

    if (!hasCachedData) {
      renderLoading(true);
    }

    try {
      // 1. Fetch products from OUR API in background
      const productsPromise = fetch(
        `${CONFIG.apiUrl}?shop=${shopDomain}&isSearch=true&searchType=instant&q=${encodeURIComponent(query)}&limit=${CONFIG.productLimit}`
      ).then((res) => res.json());

      // 2. Fetch collections from Shopify Predictive Search API in background
      const rootUrl = window.Shopify && window.Shopify.routes ? window.Shopify.routes.root : "/";
      const collectionsPromise = fetch(
        `${rootUrl}search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=collection&resources[limit]=5`
      ).then((res) => res.json());

      const [productsData, collectionsData] = await Promise.all([
        productsPromise,
        collectionsPromise,
      ]);

      // 3. Update Cache silently
      sessionStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        productsData,
        collectionsData
      }));

      // 4. Update UI with fresh data if user hasn't changed query
      const inputEl = document.getElementById("cfp-main-search-input");
      const currentQuery = inputEl ? inputEl.value.trim().toLowerCase() : "";
      if (currentQuery === trimmedQuery) {
        renderCollections(collectionsData, query);
        renderProducts(productsData, query);
      }

    } catch (error) {
      console.error("Instant Search Error:", error);
      if (!hasCachedData) {
        document.getElementById("cfp-search-products").innerHTML = 
          `<div class="cfp-search-no-results">Something went wrong. Please try again.</div>`;
        document.getElementById("cfp-search-collections").innerHTML = "";
      }
    } finally {
      if (!hasCachedData) renderLoading(false);
    }
  }

  function renderCollections(data, query, isDefault = false) {
    const list = document.getElementById("cfp-search-collections");
    const titleElement = document.getElementById("cfp-collections-title");
    let collections = [];

    if (data.resources && data.resources.results && data.resources.results.collections) {
      collections = data.resources.results.collections;
    } else if (data.collections) {
      collections = data.collections;
    }

    if (query && query.trim().length > 0) {
      if (titleElement) titleElement.style.display = "none";
    } else {
      if (titleElement) titleElement.style.display = "block";
    }

    if (collections.length === 0 && (!query || query.trim().length === 0)) {
      list.innerHTML = `<li style="color: #64748b; font-size: 14px;">No collections found.</li>`;
      return;
    }

    let html = "";
    
    // If there is a query, show the exact search term at the top
    if (query && query.trim().length > 0) {
      html += `
        <li>
          <a href="/search?q=${encodeURIComponent(query)}" style="font-weight: 700; color: #000;">
            ${query}
          </a>
        </li>
      `;
    }

    collections.forEach((c) => {
      const collectionUrl = c.url || `/collections/${c.handle}`;
      let displayTitle = c.title;
      
      // Highlight matching query
      if (query && query.trim().length > 0) {
        const regex = new RegExp(`(${query})`, 'gi');
        displayTitle = displayTitle.replace(regex, '<strong>$1</strong>');
      }

      html += `
        <li>
          <a href="${collectionUrl}">
            ${displayTitle}
          </a>
        </li>
      `;
    });

    list.innerHTML = html;
  }

  function renderProducts(data, query) {
    console.log("CFP: renderProducts called with", data.products ? data.products.length : 0, "products");
    const grid = document.getElementById("cfp-search-products");
    const products = data.products || [];

    if (products.length === 0) {
      grid.innerHTML = query 
        ? `<div class="cfp-search-no-results">No products found for "${query}"</div>`
        : `<div class="cfp-search-no-results">No trending products found.</div>`;
      return;
    }

    let html = "";
    products.forEach((p) => {
      // 1. Identify Color Option Index
      let colorOptionIndex = -1;
      let parsedOptions = [];
      if (p.options) {
        try {
          parsedOptions = typeof p.options === 'string' ? JSON.parse(p.options) : p.options;
          colorOptionIndex = parsedOptions.findIndex(o => o.name && (o.name.toLowerCase() === 'color' || o.name.toLowerCase() === 'colour'));
        } catch(e){}
      }

      // 2. Extract Color Swatches from Variants
      let swatchesHtml = "";
      let defaultImageUrl = "";
      let hasMatchedColor = false;
      
      if (colorOptionIndex !== -1 && p.variants && p.variants.length > 0) {
        const optionKey = `option${colorOptionIndex + 1}`; // option1, option2, or option3
        const uniqueColors = new Map();

        p.variants.forEach(v => {
          const colorName = v[optionKey];
          // We only take variants with images for swatches
          if (colorName && !uniqueColors.has(colorName) && v.imageUrl) {
            const numericId = v.id ? v.id.replace('gid://shopify/ProductVariant/', '') : '';
            uniqueColors.set(colorName, { imgUrl: v.imageUrl, variantId: numericId });
          }
        });

        if (uniqueColors.size > 0) {
          swatchesHtml += `<div class="cfp-product-swatches">`;
          const colorsArray = Array.from(uniqueColors.entries());
          
          let activeIndex = 0;
          if (query) {
             const q = query.toLowerCase();
             const foundIndex = colorsArray.findIndex(c => c[0].toLowerCase().includes(q));
             if (foundIndex !== -1) {
                activeIndex = foundIndex;
                hasMatchedColor = true;
             }
          }

          defaultImageUrl = colorsArray[activeIndex][1].imgUrl;
          
          colorsArray.forEach(([colorName, data], index) => {
             const isHidden = index >= 5 ? 'cfp-swatch-hidden' : '';
             const isActive = index === activeIndex ? 'cfp-swatch-active' : '';
             
             // We use onmouseenter for instant preview and onclick for selection.
             swatchesHtml += `<div class="cfp-swatch-item ${isActive} ${isHidden}" 
                  data-tooltip="${colorName}" 
                  onclick="event.preventDefault(); 
                           const card = this.closest('.cfp-search-product-card');
                           card.querySelector('.cfp-main-img').src='${data.imgUrl}';
                           const swatches = this.closest('.cfp-product-swatches').querySelectorAll('.cfp-swatch-item');
                           swatches.forEach(s => s.classList.remove('cfp-swatch-active'));
                           this.classList.add('cfp-swatch-active');
                           if('${data.variantId}') card.href='/products/${p.handle}?variant=${data.variantId}';">
                <img src="${data.imgUrl}" alt="${colorName}" />
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
        }
      }

      // 3. Extract main image
      let imageUrl = "";
      if (hasMatchedColor && defaultImageUrl) {
        // If search matched a color swatch, force use that color's image!
        imageUrl = defaultImageUrl;
      } else if (p.merchandisingImage) {
        imageUrl = p.merchandisingImage;
      } else if (p.images) {
        try {
          const imgs = typeof p.images === "string" ? JSON.parse(p.images) : p.images;
          if (imgs && imgs.length > 0) {
            imageUrl = typeof imgs[0] === "string" ? imgs[0] : imgs[0].url || imgs[0].src;
          }
        } catch (e) {}
      }
      
      // If we still don't have an image, but we have a swatch image, use it
      if (!imageUrl && defaultImageUrl) {
         imageUrl = defaultImageUrl;
      }

      if (!imageUrl) {
         imageUrl = "https://cdn.shopify.com/s/images/admin/no-image-large.gif";
      }

      const price = p.priceMin !== undefined ? `$${p.priceMin}` : ""; 
      
      html += `
        <a href="/products/${p.handle}" class="cfp-search-product-card">
          <div class="cfp-search-product-image-wrap">
            <img src="${imageUrl}" alt="${p.title}" class="cfp-main-img" />
          </div>
          <div class="cfp-search-product-title" style="margin-top: 12px; font-size: 14px; font-weight: 500; text-align: center;">${p.title}</div>
          ${swatchesHtml}
          <div class="cfp-search-product-price" style="margin-top: 8px; text-align: center;">${price}</div>
        </a>
      `;
    });

    grid.innerHTML = html;
  }
});




