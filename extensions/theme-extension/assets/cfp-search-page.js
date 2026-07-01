/**
 * CFP Search Page V2
 * Logic for the Search results page grid and filters.
 * Uses the same "Swap instead of Hide" architecture as the Collection module.
 */

(async function() {
  console.log("[CFP V2] Search Page Module Initialized");

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
      
      let data;
      if (mergedParams.q || mergedParams.isSearch) {
        data = await API.fetchSearchData(mergedParams);
      } else {
        data = await API.fetchCollectionData('', mergedParams);
      }
      
      const gridHtml = UIBuilder.renderGrid(data.products, mergedParams, settings, data.mergedValues);
      const paginationHtml = UIBuilder.renderPagination(data.totalCount || data.totalProducts, mergedParams, settings);
      
      const mainContent = document.querySelector('.cfp-main-content');
      if (mainContent) {
         mainContent.innerHTML = gridHtml + paginationHtml;
         mainContent.style.opacity = '1';
      }
      
      const countEl = document.getElementById('cfp-product-count');
      if (countEl) countEl.innerHTML = `Showing <b>${data.totalProducts}</b> products`;
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

  let nativeGrid = await waitForElement(Adapter.findGrid, 3000);
  
  if (!nativeGrid) {
    console.warn("[CFP V2] Could not find the native product grid on Search page. Will use fallback container.");
  } else {
    // 2.5 Advanced UI Polish: Layout Preserving Hide (Opacity)
    nativeGrid.style.opacity = '0';
    nativeGrid.style.pointerEvents = 'none';
    nativeGrid.style.transition = 'opacity 0.2s ease';
  }

  // 2. Build clean initial params — only extract q from the URL (not all URL params like pb=0)
  const searchParams = new URLSearchParams(window.location.search);
  const searchTerms = searchParams.get('q') || '';
  const initialSortBy = searchParams.get('sort_by') || 'best-selling';

  // queryParams holds the stable base params for this search session
  const queryParams = {
    q: searchTerms,
    sortBy: initialSortBy
  };

  const nativeFilters = Adapter.findFilters();
  if (nativeFilters) {
     nativeFilters.style.opacity = '0';
     nativeFilters.style.pointerEvents = 'none';
  }

  // Hide common native toolbars and layout wrappers aggressively
  const hideStyles = document.createElement('style');
  hideStyles.innerHTML = `
    /* Hide native toolbars and filters */
    .CollectionToolbar, .collection-toolbar, .facets, .collection-filters, #FacetFiltersForm, .filters-toolbar, .facets-vertical-sort { display: none !important; }
    .CollectionInner__Sidebar { display: none !important; }
    .CollectionInner__Products { width: 100% !important; margin: 0 !important; padding: 0 !important; }
    .ProductListWrapper > header { display: none !important; }
    .PageHeader__Right, .PageHeader .Segment__Content { display: none !important; } /* Prestige native sort on search page */
    .Search__Sort { display: none !important; }
    #collection-sort-popover { display: none !important; }
  `;
  document.head.appendChild(hideStyles);

  console.log("[CFP V2] Fetching data for Search term:", searchTerms);

  // Use fetchSearchData (sends isSearch=true + q + sortBy + page + limit — exactly like V1)
  const data = await API.fetchSearchData({ ...queryParams, page: 1 });

  if (!data || !data.products) {
    console.error("[CFP V2] Failed to fetch data from API for Search. Falling back to native theme.");
    return; // Leave the native grid intact!
  }

  const UIBuilder = window.CFP_V2.UIBuilder;
  if (!UIBuilder) {
    console.error("[CFP V2] UIBuilder missing.");
    return;
  }

  // 3. Render HTML using UIBuilder
  const settings = window.CFP_V2.settings || {};
  // For Search, we may use search_settings instead of collection_settings if defined, but we fallback to collection settings for grid layout
  const newHtml = UIBuilder.renderLayout(data, queryParams, settings);

  // 4. Hot-swap the native grid with our generated HTML
  const nativePagination = Adapter.findPagination();
  
  if (nativeFilters) nativeFilters.remove();
  if (nativePagination) nativePagination.remove();

  if (nativeGrid) {
    Adapter.swapElement(nativeGrid, newHtml);
  } else {
    // Fallback injection
    const fallbackContainer = document.querySelector('#MainContent') || document.querySelector('main') || document.body;
    const wrapper = document.createElement('div');
    wrapper.className = "cfp-injected-container";
    wrapper.style.padding = "40px 20px";
    
    // Create the "SEARCH" title and input for the fallback injection
    const headerHtml = `
      <div class="cfp-page-header" style="text-align: center; margin: 40px auto; max-width: 600px;">
        <h1 style="margin-bottom: 20px; font-size: 28px;">Search</h1>
        <form action="/search" method="get" role="search" style="position: relative; display: flex; align-items: center; max-width: 400px; margin: 0 auto 30px;">
          <input type="text" name="q" value="${searchTerms}" placeholder="Search for..." style="width: 100%; padding: 12px 40px 12px 15px; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 16px; outline: none;" />
          <button type="submit" style="position: absolute; right: 10px; background: none; border: none; cursor: pointer; padding: 5px;">
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </button>
        </form>
      </div>
    `;
    
    wrapper.innerHTML = headerHtml + newHtml;
    fallbackContainer.prepend(wrapper);
  }
  
  bindUIEvents();
  
  // Activate lazy image loading for the initial render
  if (window.CFP_V2 && window.CFP_V2.initLazyImages) {
    setTimeout(() => {
        window.CFP_V2.initLazyImages();
    }, 50);
  }
  
  console.log("[CFP V2] Search Page Injection complete.");

})();
