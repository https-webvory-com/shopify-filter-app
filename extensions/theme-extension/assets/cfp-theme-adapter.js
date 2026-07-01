/**
 * CFP Theme Adapter V2
 * Responsible for finding DOM elements across various Shopify themes.
 */

window.CFP_V2 = window.CFP_V2 || {};

window.CFP_V2.ThemeAdapter = (function() {
  
  // --- 2. Theme Registry ---
  const ThemeRegistry = {
    dawn: { grid: '#ProductGridContainer', filters: '#FacetFiltersForm', pagination: '.pagination-wrapper' },
    prestige: { grid: '.ProductList', filters: '.CollectionFilters', pagination: '.Pagination' },
    sense: { grid: '#ProductGridContainer', filters: '#FacetFiltersForm', pagination: '.pagination-wrapper' },
    generic: {} // Fallbacks handled below
  };

  function getThemePattern() {
    if (window.Shopify && window.Shopify.theme) {
      const themeName = (window.Shopify.theme.name || "").toLowerCase();
      for (const [key, pattern] of Object.entries(ThemeRegistry)) {
         if (themeName.includes(key)) return pattern;
      }
    }
    return ThemeRegistry.generic;
  }
  const themePattern = getThemePattern();

  // --- 3. Diagnostics ---
  function reportDiagnostic(elementName) {
    console.warn(`[CFP Adapter] Diagnostics: Could not automatically locate ${elementName} on this theme. Using fallback or failing.`);
    // Future: API call to backend telemetry
  }

  // --- 4. Element Finder with Cache & Heuristics ---
  function findElement(name, overrideSelector, themeSelector, heuristicFn) {
    // A. Check Liquid Override
    if (overrideSelector) {
      try {
        const el = document.querySelector(overrideSelector);
        if (el) return el;
      } catch(e) {
        console.warn(`[CFP Adapter] Invalid custom selector provided for ${name}: ${overrideSelector}`);
      }
    }

    // B. Check DOM Cache (from a previous successful visit)
    const cached = window.CFP_V2.DOMCache ? window.CFP_V2.DOMCache.get(name) : null;
    if (cached) {
      try {
        const el = document.querySelector(cached);
        if (el) return el; // Cache hit!
      } catch(e) {}
    }

    // C. Check Theme Registry
    if (themeSelector) {
      try {
        const el = document.querySelector(themeSelector);
        if (el) {
          if (window.CFP_V2.DOMCache) window.CFP_V2.DOMCache.set(name, themeSelector);
          return el;
        }
      } catch(e) {}
    }

    // D. Check Smart Heuristics
    const elAndSelector = heuristicFn(); // returns { el, selector }
    if (elAndSelector && elAndSelector.el) {
      if (window.CFP_V2.DOMCache) window.CFP_V2.DOMCache.set(name, elAndSelector.selector);
      return elAndSelector.el;
    }

    // E. Fail & Report
    reportDiagnostic(name);
    return null;
  }

  // Smart Heuristic Functions
  function detectGridDynamically() {
    const possible = [
      '.product-grid', '#product-grid', '.collection-grid', '.grid--collection', '[data-section-type="collection-template"]', 'ul.grid',
      '.ProductList', '.ProductList--grid', '#search-results', '.search-results', '.template-search__results', 
      '.Search__Results', '#Search', '.product-list', '#product-list', '.Product__Wrapper'
    ];
    for (let selector of possible) {
       const el = document.querySelector(selector);
       if (el && el.children.length > 0) return { el, selector };
    }
    return null;
  }

  function detectFiltersDynamically() {
    const possible = ['.collection-filters', '.facets', '.sidebar-filter', '.filter-form', 'form.facets__form'];
    for (let selector of possible) {
       const el = document.querySelector(selector);
       if (el) return { el, selector };
    }
    return null;
  }

  function detectPaginationDynamically() {
    const possible = ['.pagination', '.collection-pagination', 'nav.pagination'];
    for (let selector of possible) {
       const el = document.querySelector(selector);
       if (el) return { el, selector };
    }
    return null;
  }

  const getOverride = (key) => window.CFP_V2.selectors && window.CFP_V2.selectors[key] ? window.CFP_V2.selectors[key] : null;

  return {
    findGrid: () => findElement('grid', getOverride('grid'), themePattern.grid, detectGridDynamically),
    findFilters: () => findElement('filters', getOverride('filters'), themePattern.filters, detectFiltersDynamically),
    findPagination: () => findElement('pagination', getOverride('pagination'), themePattern.pagination, detectPaginationDynamically),
    
    swapElement: (nativeElement, newElementHtml) => {
      if (!nativeElement) return false;
      const wrapper = document.createElement('div');
      wrapper.className = "cfp-injected-container";
      wrapper.innerHTML = newElementHtml;
      nativeElement.replaceWith(wrapper);
      return true;
    }
  };
})();
