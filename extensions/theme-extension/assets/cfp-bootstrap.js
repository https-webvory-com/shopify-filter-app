/**
 * CFP Bootstrap V2
 * Lightweight entry point that dynamically loads modules based on page context.
 */

(function() {
  console.log("CFP Bootstrap V2 loaded.");

  // Configuration
  window.CFP_V2 = window.CFP_V2 || {};
  
  // Global object to store settings parsed from App Blocks
  window.CFP_V2.settings = window.CFP_V2.settings || {};

  // Lazy image loader using IntersectionObserver
  // Images use data-src instead of src — they only load when entering viewport
  // This prevents re-fetching when the grid is re-rendered after filtering
  window.CFP_V2.initLazyImages = function() {
    const images = document.querySelectorAll('img.cfp-lazy[data-src]');
    if (!images.length) return;

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(function(entries, obs) {
        entries.forEach(function(entry) {
          if (entry.isIntersecting) {
            const img = entry.target;
            if (img.dataset.src) {
               img.src = img.dataset.src;
               img.removeAttribute('data-src');
               img.classList.remove('cfp-lazy');
            }
            obs.unobserve(img);
          }
        });
      }, { rootMargin: '200px 0px' }); // Pre-load 200px before entering viewport

      images.forEach(function(img) { observer.observe(img); });
    } else {
      // Fallback for old browsers: load all immediately
      images.forEach(function(img) {
        if (img.dataset.src) {
           img.src = img.dataset.src;
           img.removeAttribute('data-src');
        }
      });
    }
  };

  function readBlockSettings() {
    // Read Collection Settings
    const collectionSettingsEl = document.getElementById('cfp-collection-settings');
    if (collectionSettingsEl) {
      window.CFP_V2.settings.collection = {
        showFilters: collectionSettingsEl.dataset.showFilters === 'true',
        filterPosition: collectionSettingsEl.dataset.filterPosition || 'left',
        desktopColumns: parseInt(collectionSettingsEl.dataset.desktopColumns) || 4,
        mobileColumns: parseInt(collectionSettingsEl.dataset.mobileColumns) || 2,
        primaryColor: collectionSettingsEl.dataset.primaryColor || '#000000',
        showDescription: collectionSettingsEl.dataset.showDescription === 'true',
        showBorder: collectionSettingsEl.dataset.showBorder === 'true',
        textAlign: collectionSettingsEl.dataset.textAlign || 'left',
        mediaAspect: collectionSettingsEl.dataset.mediaAspect || 'rectangle',
        imageSize: collectionSettingsEl.dataset.imageSize || 'cover',
        saleLabelType: collectionSettingsEl.dataset.saleLabelType || 'text',
        saleLabelPos: collectionSettingsEl.dataset.saleLabelPos || 'top-left',
        saleBg: collectionSettingsEl.dataset.saleBg || '#FF4E4E',
        saleText: collectionSettingsEl.dataset.saleText || '#FFFFFF',
        soldoutBg: collectionSettingsEl.dataset.soldoutBg || '#000000',
        soldoutText: collectionSettingsEl.dataset.soldoutText || '#FFFFFF',
        soldoutPos: collectionSettingsEl.dataset.soldoutPos || 'top-left'
      };
    } else {
      window.CFP_V2.settings.collection = { showFilters: true, filterPosition: 'left', desktopColumns: 4, mobileColumns: 2, textAlign: 'left', mediaAspect: 'rectangle', imageSize: 'cover' };
    }

    // Read Search Settings
    const searchSettingsEl = document.getElementById('cfp-search-settings');
    if (searchSettingsEl) {
      window.CFP_V2.settings.search = {
        showCollections: searchSettingsEl.dataset.showCollections === 'true',
        showBlogs: searchSettingsEl.dataset.showBlogs === 'true',
        showPages: searchSettingsEl.dataset.showPages === 'true',
        suggestionCount: parseInt(searchSettingsEl.dataset.suggestionCount) || 4,
        desktopColumns: parseInt(searchSettingsEl.dataset.desktopColumns) || 4,
        mobileColumns: parseInt(searchSettingsEl.dataset.mobileColumns) || 2,
        showBorder: searchSettingsEl.dataset.showBorder === 'true',
        textAlign: searchSettingsEl.dataset.textAlign || 'left',
        mediaAspect: searchSettingsEl.dataset.mediaAspect || 'rectangle',
        imageSize: searchSettingsEl.dataset.imageSize || 'cover',
        saleLabelType: searchSettingsEl.dataset.saleLabelType || 'text',
        saleLabelPos: searchSettingsEl.dataset.saleLabelPos || 'top-left',
        saleBg: searchSettingsEl.dataset.saleBg || '#FF4E4E',
        saleText: searchSettingsEl.dataset.saleText || '#FFFFFF',
        soldoutBg: searchSettingsEl.dataset.soldoutBg || '#000000',
        soldoutText: searchSettingsEl.dataset.soldoutText || '#FFFFFF',
        soldoutPos: searchSettingsEl.dataset.soldoutPos || 'top-left'
      };
    } else {
      window.CFP_V2.settings.search = { suggestionCount: 4, desktopColumns: 4, mobileColumns: 2, textAlign: 'left', mediaAspect: 'rectangle', imageSize: 'cover' };
    }
  }

  function loadModule(moduleName) {
    try {
      const src = window.CFP_V2.assetUrlBase + moduleName + '.js';
      const script = document.createElement('script');
      script.src = src;
      script.defer = true;
      document.body.appendChild(script);
      console.log('[CFP V2] Loading module: ' + moduleName);
    } catch (err) {
      console.error('[CFP V2] Failed to load module ' + moduleName + ':', err);
    }
  }

  function detectPageAndLoad() {
    const pathname = window.location.pathname;
    
    // Read any active configurations from blocks first
    readBlockSettings();

    // Route: Collection Page
    if (pathname.includes('/collections/')) {
      loadModule('cfp-collection');
    } else if (pathname.includes('/search')) {
      // Search results page — has its own dedicated module, do NOT also load instant-search
      loadModule('cfp-search-page');
    }
    
    // Instant search (autocomplete dropdown) — load on EVERY page EXCEPT the search results page
    // On the search results page, cfp-search-page handles everything
    if (!pathname.includes('/search')) {
      if (document.querySelector('input[name="q"], input[type="search"]') !== null) {
        loadModule('cfp-instant-search');
      }
    }
  }

  // Initialize Router
  detectPageAndLoad();

})();
