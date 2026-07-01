/**
 * CFP Collection V2
 * Logic for the Collection page grid and filters.
 * Implements the "Swap instead of Hide" architecture.
 */

(async function() {
  console.log("[CFP V2] Collection Module Initialized");

  const Adapter = window.CFP_V2.ThemeAdapter;
  const API = window.CFP_V2.API;

  if (!Adapter || !API) {
    console.error("[CFP V2] Required dependencies missing.");
    return;
  }

  // 1. Wait until native grid exists
  const waitForElement = (selectorFn, timeout = 5000) => {
    return new Promise((resolve) => {
      const el = selectorFn();
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = selectorFn();
        if (el) {
          resolve(el);
          observer.disconnect();
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  };

  const bindUIEvents = () => {
    const trigger = document.getElementById('cfp-drawer-trigger-btn');
    const closeBtn = document.getElementById('cfp-close-btn');
    const overlay = document.getElementById('cfp-overlay');
    const sidebar = document.getElementById('cfp-sidebar');
    const applyBtn = document.getElementById('cfp-apply-btn');
    
    if (trigger && sidebar) {
      trigger.addEventListener('click', () => {
        sidebar.classList.add('cfp-sidebar--open');
        if (overlay) overlay.classList.add('cfp-overlay--visible');
        document.body.style.overflow = 'hidden';
      });
    }
    
    const closeDrawer = () => {
      if (sidebar) sidebar.classList.remove('cfp-sidebar--open');
      if (overlay) overlay.classList.remove('cfp-overlay--visible');
      document.body.style.overflow = '';
    };

    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);
    if (applyBtn) applyBtn.addEventListener('click', closeDrawer);
    
    // Custom sort dropdown
    const sortTrigger = document.getElementById('cfp-custom-sort-trigger');
    const sortDropdown = document.getElementById('cfp-custom-sort-dropdown');
    if (sortTrigger && sortDropdown) {
      sortTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        sortTrigger.parentElement.classList.toggle('is-open');
      });
      document.addEventListener('click', () => {
        sortTrigger.parentElement.classList.remove('is-open');
      });
      document.querySelectorAll('.cfp-custom-sort__option').forEach(option => {
        option.addEventListener('click', (e) => {
          e.stopPropagation();
          const val = option.getAttribute('data-value');
          const text = option.textContent;
          const label = document.getElementById('cfp-custom-sort-label');
          if (label) label.textContent = text;
          sortTrigger.parentElement.classList.remove('is-open');
          
          window.CFP_V2.currentSortBy = val;
          fetchAndRenderData();
        });
      });
    }

    const gatherFilters = () => {
      let state = { options: {}, metafields: {}, tags: [], vendors: [], productTypes: [], collections: [], priceMin: undefined, priceMax: undefined };
      const sidebar = document.getElementById('cfp-sidebar');
      if (!sidebar) return state;

      sidebar.querySelectorAll('.cfp-filter-checkbox:checked, option:checked').forEach(input => {
         const name = input.name || input.parentElement.name;
         const val = input.value;
         if (!val || val.trim() === '') return;
         if (name === 'vendor') state.vendors.push(val);
         else if (name === 'product_type') state.productTypes.push(val);
         else if (name === 'collection') state.collections.push(val);
         else if (name === 'tag' || name === 'tags') state.tags.push(val);
         else if (name && name.startsWith('option-')) {
            const opt = name.replace('option-', '');
            if (!state.options[opt]) state.options[opt] = [];
            state.options[opt].push(val);
         }
         else if (name && name.startsWith('metafield-')) {
            const meta = name.replace('metafield-', '');
            if (!state.metafields[meta]) state.metafields[meta] = [];
            state.metafields[meta].push(val);
         }
      });

      const priceMin = document.getElementById('cfp-slider-range-min');
      const priceMax = document.getElementById('cfp-slider-range-max');
      if (priceMin && priceMax) {
        const absMin = parseInt(priceMin.min) || 0;
        const absMax = parseInt(priceMin.max) || 0;
        const currentMin = parseInt(priceMin.value) || 0;
        const currentMax = parseInt(priceMax.value) || 0;
        // Only send price params if user moved them away from defaults (same as V1)
        if (currentMin > absMin) state.priceMin = currentMin;
        if (absMax > 0 && currentMax < absMax) state.priceMax = currentMax;
      }
      return state;
    };

    const fetchAndRenderData = async () => {
      const activeState = gatherFilters();
      if (window.CFP_V2.currentSortBy) {
         activeState.sortBy = window.CFP_V2.currentSortBy;
      }
      
      const mergedParams = { ...queryParams, ...activeState, page: 1 };
      document.querySelector('.cfp-main-content').style.opacity = '0.5';
      
      const pathParts = window.location.pathname.split('/');
      let collectionHandle = 'all';
      if (pathParts.includes('collections')) {
        const idx = pathParts.indexOf('collections');
        if (pathParts[idx + 1]) collectionHandle = pathParts[idx + 1];
      }
      
      let data;
      if (mergedParams.q || mergedParams.isSearch) {
         data = await window.CFP_V2.API.fetchSearchData(mergedParams);
      } else {
         data = await window.CFP_V2.API.fetchCollectionData(collectionHandle, mergedParams);
      }
      
      const gridHtml = UIBuilder.renderGrid(data.products, mergedParams, settings, data.mergedValues);
      const paginationHtml = UIBuilder.renderPagination(data.totalCount || data.totalProducts, mergedParams, settings);
      
      const mainContent = document.querySelector('.cfp-main-content');
      if (mainContent) {
         mainContent.innerHTML = gridHtml + paginationHtml;
         mainContent.style.opacity = '1';
         if (window.CFP_V2 && window.CFP_V2.initLazyImages) {
           setTimeout(() => {
               window.CFP_V2.initLazyImages();
           }, 50);
         }
      }
      
      const countEl = document.getElementById('cfp-product-count');
      if (countEl) countEl.innerHTML = `Showing <b>${data.totalCount || data.totalProducts}</b> products`;
    };

    const setupDynamicFieldListeners = () => {
      const sidebar = document.getElementById('cfp-sidebar');
      if (!sidebar) return;
      
      sidebar.querySelectorAll('.cfp-filter-checkbox').forEach(input => {
         if (input.type === 'range') return;
         input.addEventListener('change', () => fetchAndRenderData());
      });

      sidebar.querySelectorAll('.cfp-search-input').forEach(searchInput => {
        searchInput.addEventListener('input', () => {
          const q = searchInput.value.toLowerCase().trim();
          const wrapper = searchInput.closest('.cfp-group');
          if (!wrapper) return;
          wrapper.querySelectorAll('.cfp-checkbox').forEach(label => {
            const txt = label.querySelector('.cfp-checkbox__label');
            const matches = !txt || txt.textContent.toLowerCase().includes(q);
            label.style.display = matches ? '' : 'none';
          });
          wrapper.querySelectorAll('.cfp-button-chip').forEach(label => {
            const txt = label.querySelector('span');
            const matches = !txt || txt.textContent.toLowerCase().includes(q);
            label.style.display = matches ? '' : 'none';
          });
          wrapper.querySelectorAll('.cfp-color-swatch').forEach(label => {
            const titleVal = label.getAttribute('title') || '';
            const matches = titleVal.toLowerCase().includes(q);
            label.style.display = matches ? 'flex' : 'none';
          });
        });
      });

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

      // Price slider events
      const rangeMin = document.getElementById('cfp-slider-range-min');
      const rangeMax = document.getElementById('cfp-slider-range-max');
      const dispMin = document.getElementById('cfp-price-min-display');
      const dispMax = document.getElementById('cfp-price-max-display');
      const track = document.getElementById('cfp-range-track');
      
      const updatePriceTrack = () => {
         if(!track || !rangeMin || !rangeMax) return;
         const min = parseInt(rangeMin.value) || 0;
         const max = parseInt(rangeMax.value) || 0;
         const absMin = parseInt(rangeMin.min) || 0;
         const absMax = parseInt(rangeMin.max) || 1000;
         const leftPct = ((min - absMin) / (absMax - absMin)) * 100;
         const rightPct = 100 - (((max - absMin) / (absMax - absMin)) * 100);
         track.style.left = leftPct + '%';
         track.style.right = rightPct + '%';
         if (dispMin) dispMin.value = min;
         if (dispMax) dispMax.value = max;
      };

      if (rangeMin && rangeMax) {
         rangeMin.addEventListener('input', () => {
            if (parseInt(rangeMin.value) > parseInt(rangeMax.value)) rangeMin.value = rangeMax.value;
            updatePriceTrack();
         });
         rangeMax.addEventListener('input', () => {
            if (parseInt(rangeMax.value) < parseInt(rangeMin.value)) rangeMax.value = rangeMin.value;
            updatePriceTrack();
         });
         rangeMin.addEventListener('change', fetchAndRenderData);
         rangeMax.addEventListener('change', fetchAndRenderData);
      }
      
      sidebar.querySelectorAll('.cfp-group__toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
          const contentId = toggle.getAttribute('aria-controls');
          const content = document.getElementById(contentId);
          if (content) {
             const isHidden = content.style.display === 'none';
             content.style.display = isHidden ? 'block' : 'none';
          }
        });
      });
    };

    setupDynamicFieldListeners();
  };

  const nativeGrid = await waitForElement(Adapter.findGrid);
  
  if (!nativeGrid) {
    console.error("[CFP V2] Could not find the native product grid. Aborting.");
    return;
  }

  // 2. Fetch data in the background (before touching the DOM)
  // Determine collection handle from URL
  const pathParts = window.location.pathname.split('/');
  let collectionHandle = 'all';
  if (pathParts.includes('collections')) {
    const idx = pathParts.indexOf('collections');
    if (pathParts[idx + 1]) {
      collectionHandle = pathParts[idx + 1];
    }
  }

  const queryParams = {};
  const searchParams = new URLSearchParams(window.location.search);
  for (const [key, value] of searchParams.entries()) {
    queryParams[key] = value;
  }

  // 2.5 Advanced UI Polish: Aggressively hide native toolbars and layout wrappers
  // We do this unconditionally because our app provides its own filters and sorting UI.
  const hideStyles = document.createElement('style');
  hideStyles.innerHTML = `
    /* Hide native toolbars and filters */
    .CollectionToolbar, .collection-toolbar, .facets, .collection-filters, #FacetFiltersForm, .filters-toolbar, .facets-vertical-sort { display: none !important; }
    .CollectionInner__Sidebar { display: none !important; }
    .CollectionInner__Products { width: 100% !important; margin: 0 !important; padding: 0 !important; }
    .ProductListWrapper > header { display: none !important; }
    .PageHeader__Right, .PageHeader .Segment__Content { display: none !important; }
    #collection-sort-popover { display: none !important; }
  `;
  document.head.appendChild(hideStyles);

  // If there are filters in the URL, visually hide the native grid while we fetch data
  // to prevent it from flashing before the swap.
  const hasFilters = Array.from(searchParams.keys()).some(k => k !== 'page' && k !== 'sort_by');
  if (hasFilters) {
    nativeGrid.style.opacity = '0';
    nativeGrid.style.pointerEvents = 'none';
    nativeGrid.style.transition = 'opacity 0.2s ease';
    
    const nativeFilters = Adapter.findFilters();
    if (nativeFilters) {
       nativeFilters.style.opacity = '0';
       nativeFilters.style.pointerEvents = 'none';
    }
  }

  // Hide the App Block container if it was added just for settings, so it doesn't leave an empty white space
  const settingsBlock = document.getElementById('cfp-collection-settings');
  if (settingsBlock) {
    const parentSection = settingsBlock.closest('.shopify-section');
    if (parentSection) {
      parentSection.style.display = 'none';
    }
  }

  console.log("[CFP V2] Fetching data for collection:", collectionHandle);
  
  const data = await API.fetchCollectionData(collectionHandle, queryParams);

  if (!data || !data.products) {
    console.error("[CFP V2] Failed to fetch data from API. Falling back to native theme.");
    return; // Leave the native grid intact!
  }

  const UIBuilder = window.CFP_V2.UIBuilder;
  if (!UIBuilder) {
    console.error("[CFP V2] UIBuilder missing.");
    return;
  }

  // 3. Render HTML using UIBuilder
  const settings = window.CFP_V2.settings || {};
  const newHtml = UIBuilder.renderLayout(data, queryParams, settings);

  // 4. Hot-swap the native grid with our generated HTML
  // We completely remove native filters and pagination if they exist separately
  const nativeFilters = Adapter.findFilters();
  const nativePagination = Adapter.findPagination();
  
  if (nativeFilters) nativeFilters.remove();
  if (nativePagination) nativePagination.remove();

  if (nativeGrid) {
    Adapter.swapElement(nativeGrid, newHtml);
  }

  bindUIEvents();
  
  if (window.CFP_V2 && window.CFP_V2.initLazyImages) {
    setTimeout(() => {
        window.CFP_V2.initLazyImages();
    }, 50);
  }
  console.log("[CFP V2] Swap complete. Zero white flash!");

})();
