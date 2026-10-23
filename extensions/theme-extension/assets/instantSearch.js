/**
 * Instant Search Implementation - Full Screen Modal
 * Hijacks the theme's default search input and displays a full-screen search modal.
 */

var API_DOMAIN = 'https://aisearchfilter.webvory.com'; // TODO: Change this to your deployed AWS API domain

// Submitted searches must redirect even when the theme uses its native search
// page instead of the Collection Filter Pro search block. Share the lookup with
// that block when both are installed; typing in autocomplete never calls it.
if (!window.cfpSearchRedirectPromise && /\/search\/?$/i.test(window.location.pathname) && window.Shopify?.shop) {
  window.cfpSearchRedirectPromise = (async () => {
    const query = new URLSearchParams(window.location.search).get('q')?.trim();
    if (!query) return false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const params = new URLSearchParams({ shop: window.Shopify.shop, q: query });
      const response = await fetch(`${API_DOMAIN}/api/search-redirect?${params}`, { signal: controller.signal });
      if (!response.ok) return false;
      const { redirectUrl } = await response.json();
      if (typeof redirectUrl !== 'string' || /[\\\u0000-\u0020\u007f]/u.test(redirectUrl)) return false;
      if (!(redirectUrl.startsWith('/') && !redirectUrl.startsWith('//')) && !/^https:\/\//i.test(redirectUrl)) return false;
      const target = new URL(redirectUrl, window.location.origin);
      if (target.username || target.password || /\/search\/?$/i.test(decodeURIComponent(target.pathname))) return false;
      if (target.href === window.location.href) return false;
      window.location.replace(target.href);
      return true;
    } catch { return false; }
    finally { clearTimeout(timer); }
  })();
}

document.addEventListener("DOMContentLoaded", async function () {
  await window.cfpSearchSettingsReady;
  const searchSettings = window.cfpSearchSettings || {};
  if (searchSettings.instantEnabled === false) return;
  // Config
  const userSettings = window.CFP_InstantSearchSettings || {};
  const CONFIG = {
    minChars: searchSettings.minChars ?? 2,
    debounceTime: 300,
    productLimit: searchSettings.productLimit ?? (userSettings.productLimit || 6),
    suggestionLimit: searchSettings.suggestionLimit ?? 6,
    collectionLimit: searchSettings.collectionLimit ?? 5,
    recentLimit: searchSettings.recentLimit ?? 4,
    manualSuggestions: searchSettings.manualSuggestions || [],
    customSelector: userSettings.customTriggerSelector || "",
    apiUrl: `${API_DOMAIN}/api/search`,
  };

  const shopDomain = window.Shopify ? window.Shopify.shop : "";


  // Search caching is optional. Never let unavailable/full storage block results.
  const INSTANT_CACHE_PREFIXES = ['cfp_instant_search_', 'cfp_instant_default_'];
  const INSTANT_CACHE_TTL = 120000;
  const INSTANT_CACHE_ENTRIES = 12;
  const INSTANT_CACHE_CHARS = 500000;

  function readInstantCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (!Array.isArray(value.productsData?.products) || !Number.isFinite(value.timestamp) || Date.now() - value.timestamp > INSTANT_CACHE_TTL) {
        sessionStorage.removeItem(key); return null;
      }
      return raw;
    } catch { return null; }
  }

  function writeInstantCache(key, productsData, collectionsData) {
    try {
      const raw = JSON.stringify({timestamp:Date.now(),productsData,collectionsData});
      const entries = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const candidate = sessionStorage.key(i);
        if (!INSTANT_CACHE_PREFIXES.some(prefix => candidate?.startsWith(prefix))) continue;
        const value = sessionStorage.getItem(candidate);
        let timestamp = 0;
        try { timestamp = JSON.parse(value).timestamp || 0; } catch {}
        entries.push({key:candidate,size:(value || '').length,timestamp});
      }
      entries.sort((a,b) => a.timestamp - b.timestamp);
      let size = entries.reduce((sum, entry) => sum + entry.size, 0);
      let count = entries.length;
      for (const entry of entries) {
        if (entry.key === key || Date.now() - entry.timestamp > INSTANT_CACHE_TTL || count >= INSTANT_CACHE_ENTRIES || size + raw.length > INSTANT_CACHE_CHARS) {
          sessionStorage.removeItem(entry.key); size -= entry.size; count--;
        }
      }
      if (raw.length > 150000) return;
      try { sessionStorage.setItem(key, raw); }
      catch {
        // Reclaim only our response cache, preserving other apps and recent searches.
        for (const entry of entries) sessionStorage.removeItem(entry.key);
        try { sessionStorage.setItem(key, raw); } catch {}
      }
    } catch {}
  }

  function instantCacheMarket() {
    return [window.Shopify?.country, window.Shopify?.currency?.active, window.Shopify?.locale, window.Shopify?.routes?.root, window.cfpCustomerTags || '', JSON.stringify(window.cfpSearchSettings || null)].join('|');
  }

  async function fetchSearchJSON(url) {
    const market=instantCacheMarket();
    const query=new URL(url,location.href).searchParams.get('q')||'';
    for(let attempt=0;attempt<31;attempt++){
      const response=await fetch(url);
      if(!response.ok)throw new Error('Search request failed: '+response.status);
      const data=await response.json();
      if(response.status!==202||!data.marketAvailabilityPending)return data;
      if(attempt===30)throw new Error('Product availability is still preparing');
      await new Promise(resolve=>setTimeout(resolve,1000));
      const input=document.getElementById('cfp-main-search-input');
      if(instantCacheMarket()!==market||(input&&input.value.trim().toLowerCase()!==query.trim().toLowerCase()))throw new Error('Search changed');
    }
  }

  function highlightSearchText(value, query) {
    const escape = text => String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    if (!query?.trim()) return escape(value);
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(value).split(new RegExp('(' + escapedQuery + ')', 'gi')).map((part, index) => index % 2 ? '<strong>' + escape(part) + '</strong>' : escape(part)).join('');
  }

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
      
      <div id="cfp-did-you-mean-container" style="display: none; padding: 12px 24px; background: #fff; border-bottom: 1px solid #e2e8f0; text-align: center; color: #64748b; font-size: 14px;">
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
      // ─────────────────────────────────────────────────────────────────────────
      // WHITELIST APPROACH: Only intercept elements that are 100% confirmed
      // to be search triggers. This prevents false-positives on country pickers,
      // currency selectors, and any other non-search UI elements.
      // ─────────────────────────────────────────────────────────────────────────

      // ── TIER 1: Precise CSS selectors for all major Shopify themes ────────────
      // Each selector here maps to a real search element in a known theme.
      const SEARCH_SELECTORS = [
        // ── Universal (standard HTML) ──
        'input[type="search"]',               // standard search input
        'input[name="q"]',                    // Shopify's conventional search param

        // ── Dawn, Sense, Refresh, CDawn (Shopify free themes) ──
        '.header__search',                    // search icon button / wrapper
        '.header__icon--search',              // icon variant
        'details.header__search > summary',   // details/summary search toggle
        'search-modal',                       // Dawn's <search-modal> custom element

        // ── Debut ──
        '.site-nav__search-toggle',

        // ── Brooklyn ──
        '.js-search-bar-toggle',

        // ── Narrative ──
        '.site-header__search',

        // ── Impulse / Turbo (Out of the Sandbox) ──
        '.navmenu-search__btn',
        '.header-search-trigger',
        '[data-search-modal-trigger]',

        // ── Prestige / Streamline (Maestrooo) ──
        '[data-action="open-search"]',

        // ── Broadcast / Venue (Invisible Themes) ──
        '.header__tool--search',
        '[data-open="search"]',

        // ── Motion / Pipeline (Archetype Themes) ──
        '[data-search-button]',
        '.mobile-nav__search',

        // ── Expanse / Kingdom ──
        '.icon-btn--search',

        // ⚠️  INTENTIONALLY REMOVED (too generic — cause false positives on
        //     country/language pickers in many themes):
        //   .search-trigger, .search-toggle, .search-bar__toggle, .js-toggle-search,
        //   .search-icon, .icon-search, .btn-search
        //
        // Use CONFIG.customSelector in admin settings for custom themes instead.
      ];


      // Add custom selector from admin settings
      if (CONFIG.customSelector) {
        SEARCH_SELECTORS.push(CONFIG.customSelector);
      }

      const combinedSelector = SEARCH_SELECTORS.join(', ');

      // ── TIER 2: aria-label only fallback for custom/unknown themes ────────────
      // STRICT: Only checks aria-label containing exact word "search".
      // We intentionally do NOT check class/id names — too many false positives
      // (e.g. country pickers, currency dropdowns could have "search" in their
      //  parent wrapper class names in some themes).
      function isSearchByAriaLabel(el) {
        if (!el) return false;
        // Check the element itself
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        if (/\bsearch\b/.test(ariaLabel)) return true;
        // Check parent element (e.g. SVG icon inside a button)
        const parent = el.parentElement;
        if (parent) {
          const pAria = (parent.getAttribute('aria-label') || '').toLowerCase();
          if (/\bsearch\b/.test(pAria)) return true;
        }
        return false;
      }

      const handleEvent = (e) => {
        // ── GATE 0: Ignore events inside our own modal/overlay ───────────────
        if (e.target.closest('.cfp-search-modal') || e.target.closest('.cfp-search-modal-overlay')) return;

        console.log(`[CFP-IS] Event triggered: ${e.type} on`, e.target);

        // ── GATE 1: Must be inside header ────────────────────────────────────
        const isCustomClick = CONFIG.customSelector && e.target.closest(CONFIG.customSelector);
        const headerContainer = e.target.closest(
          'header, sticky-header, .header, #header, .site-header, .masthead, ' +
          '#shopify-section-header, .shopify-section--header'
        );
        if (!headerContainer && !isCustomClick) {
          console.log(`[CFP-IS] GATE 1 Failed: Not inside header container. isCustomClick: ${!!isCustomClick}`);
          return;
        }

        // ── GATE 1.5: Explicitly EXCLUDE localization, cart, account, wishlist ────
        // This must run BEFORE any search selector matching because a broad custom selector
        // (e.g. '.header__icon') might accidentally match these other buttons too.
        const IGNORE_SELECTORS = [
          // Localization / Country / Currency
          'localization-form',
          '.localization-form',
          '.disclosure',
          '.disclosure__toggle',
          '[data-disclosure-toggle]',
          '[aria-controls*="localization"]',
          '[aria-controls*="country"]',
          '[aria-controls*="currency"]',
          '[aria-controls*="locale"]',
          'form[action="/localization"]',
          'form[action*="localization"]',
          '.country-selector',
          '.currency-selector',
          '.language-selector',
          '.locale-selector',
          '.country-flag',
          '.flag-icon',
          '[data-country-selector]',
          '[data-currency-selector]',
          '[data-locale-selector]',
          'details.localization-selector',
          'details[id*="country"]',
          'details[id*="locale"]',
          'details[id*="currency"]',
          // Third-party Translation/Currency Apps
          'weglot-switcher',
          '.weglot-container',
          'ly-as-desktop',
          '.ly-custom-dropdown',
          '.doubly-wrapper',
          '.transcy-switcher',
          '.gtranslate_wrapper',
          '#gtranslate_wrapper',
          '.wg-default',
          // Header Account / User
          '.header__icon--account',
          '.site-header__account',
          '[href*="/account"]',
          // Header Cart
          '.header__icon--cart',
          '.site-header__cart',
          '[href*="/cart"]',
          // Header Wishlist
          '.header__icon--wishlist',
          '.site-header__wishlist',
          '[href*="wishlist"]',
          '.swym-button',
          '.swym-wishlist'
        ].join(', ');

        const ignoreMatch = e.target.closest(IGNORE_SELECTORS);
        if (ignoreMatch) {
          console.log(`[CFP-IS] GATE 1.5 Failed: Clicked element is inside IGNORE_SELECTORS:`, ignoreMatch);
          return; // ← Ignore these UI elements completely
        }

        // ── GATE 2: Find the actual search trigger element ────────────────────
        let trigger = e.target.closest ? e.target.closest(combinedSelector) : null;
        console.log(`[CFP-IS] GATE 2 Check: trigger from combinedSelector =`, trigger);

        // TIER 2: strict aria-label fallback (already confirmed inside header)
        // But also ensure the aria-label element is NOT localization-related
        if (!trigger && isSearchByAriaLabel(e.target)) {
          console.log(`[CFP-IS] GATE 2.5 Check: Found by aria-label fallback`);
          // Double-check the element itself isn't localization (aria-label="Change country" etc.)
          const ariaLabel = (e.target.getAttribute('aria-label') || '').toLowerCase();
          const isLocale = /\b(country|language|locale|currency|region|flag)\b/.test(ariaLabel);
          if (!isLocale) {
            trigger = e.target;
            console.log(`[CFP-IS] GATE 2.5: Assigned trigger by aria-label:`, trigger);
          } else {
            console.log(`[CFP-IS] GATE 2.5: Rejected aria-label match because it's a locale element`);
          }
        }

        if (!trigger) {
          console.log(`[CFP-IS] GATE 2 Failed: No search trigger matched.`);
          return; // Inside header but not a search element — skip
        }

        // ── GATE 3: Filter event types ────────────────────────────────────────
        if (e.type === 'keydown' && e.key !== 'Enter') return;

        // ── All gates passed — intercept and open our search modal ────────────
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        closeThemeSearch();
        openModal(trigger);
      };


      // Only listen to 'click' and 'keydown' globally.
      // ✗ 'focus'      — removed: when country dropdown opens, theme JS focuses a hidden
      //                  search input, firing our listener incorrectly.
      // ✗ 'mousedown'  — removed: 'click' is sufficient and fires after mouseup,
      //                  preventing accidental double-triggers.
      // ✗ 'pointerdown'— removed: same reason as mousedown.
      // ✗ 'touchstart' — removed: 'click' fires on touch too (300ms delay is fine
      //                  since we preventDefault on actual search clicks).
      ['click', 'keydown'].forEach(eventType => {
        document.addEventListener(eventType, handleEvent, true);
      });

      // Targeted 'focus' listener ONLY for real search inputs in header.
      // Handles keyboard users who tab into the search box.
      // Strictly guarded: INPUT tag + search type/name + in header + not our own modal.
      document.addEventListener('focus', (e) => {
        const el = e.target;
        if (!el) return;
        if (el.tagName !== 'INPUT') return;                           // Only input elements
        if (el.type !== 'search' && el.name !== 'q') return;         // Only search inputs
        if (el.closest('.cfp-search-modal')) return;                  // Not our own modal input
        const inHeader = el.closest(
          'header, sticky-header, .header, #header, .site-header, #shopify-section-header'
        );
        if (!inHeader) return;                                        // Must be in header
        
        // Ensure it's not a search input hidden inside a country/localization picker!
        // We reuse the same IGNORE_SELECTORS defined above.
        // If it's inside localization/cart/user, skip it.
        const IGNORE_SELECTORS = [
          'localization-form', '.localization-form', '.disclosure', '.disclosure__toggle',
          '[data-disclosure-toggle]', '[aria-controls*="localization"]', '[aria-controls*="country"]',
          '[aria-controls*="currency"]', '[aria-controls*="locale"]', 'form[action="/localization"]',
          'form[action*="localization"]', '.country-selector', '.currency-selector', '.language-selector',
          '.locale-selector', '.country-flag', '.flag-icon', '[data-country-selector]', '[data-currency-selector]', '[data-locale-selector]',
          'details.localization-selector', 'details[id*="country"]', 'details[id*="locale"]', 'details[id*="currency"]',
          'weglot-switcher', '.weglot-container', 'ly-as-desktop', '.ly-custom-dropdown', '.doubly-wrapper',
          '.transcy-switcher', '.gtranslate_wrapper', '#gtranslate_wrapper', '.wg-default',
          '.header__icon--account', '.site-header__account', '[href*="/account"]',
          '.header__icon--cart', '.site-header__cart', '[href*="/cart"]',
          '.header__icon--wishlist', '.site-header__wishlist', '[href*="wishlist"]', '.swym-button', '.swym-wishlist'
        ].join(', ');
        
        const focusIgnoreMatch = el.closest(IGNORE_SELECTORS);
        if (focusIgnoreMatch) {
           console.log(`[CFP-IS] Focus ignored because it matches IGNORE_SELECTORS:`, focusIgnoreMatch);
           return;
        }

        console.log(`[CFP-IS] Focus SUCCESS: Intercepting search input focus!`);
        // Valid search input focused in header — intercept
        e.preventDefault();
        closeThemeSearch();
        openModal(el);
      }, true);

    // 2. Modal Close Listeners
    document.getElementById("cfp-search-close").addEventListener("click", closeModal);
    overlay.addEventListener("click", closeModal);
    document.addEventListener("keydown", (e) => {
      if (document.querySelector('.cfp-native-quick-view[open]')) return;
      if (e.key === "Escape" && modal.classList.contains("cfp-open")) {
        closeModal();
      }
    });

    // 3. Main Input Listener
    let debounceTimer;
    mainInput.addEventListener("input", (e) => {
      const query = e.target.value.trim();
      clearTimeout(debounceTimer);

      if (!query) {
        fetchDefaultView();
        return;
      }

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
    if (!query || CONFIG.recentLimit === 0) return;
    try {
      let searches = readRecentSearches();
      searches = searches.filter(q => q.toLowerCase() !== query.toLowerCase()); // Remove duplicates
      searches.unshift(query); // Add to beginning
      searches = searches.slice(0, CONFIG.recentLimit ?? 4);
      localStorage.setItem('cfp_recent_searches', JSON.stringify(searches));
    } catch {} // Storage restrictions must not prevent search submission.
  }

  function readRecentSearches() {
    try {
      const value = JSON.parse(localStorage.getItem('cfp_recent_searches') || '[]');
      return Array.isArray(value) ? value.filter(s => typeof s === 'string' && s.length <= 200).slice(0, CONFIG.recentLimit ?? 4) : [];
    } catch { return []; }
  }

  function openModal(triggerElement) {
    // Already open — don't re-open
    if (modal.classList.contains('cfp-open')) return;

    modal.style.top = '0px';
    overlay.classList.add('cfp-open');
    modal.classList.add('cfp-open');

    // Prevent background scrolling.
    // Save any existing overflow value so we can restore it precisely on close.
    modal._prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('cfp-search-active');

    // Load default view if input is empty
    if (mainInput.value.trim().length === 0) {
      fetchDefaultView();
    }

    // Focus the input after transition
    setTimeout(() => { mainInput.focus(); }, 100);
  }

  function closeModal() {
    if (!modal.classList.contains('cfp-open')) return; // Already closed

    overlay.classList.remove('cfp-open');
    modal.classList.remove('cfp-open');

    // Restore body overflow to what it was before we set it
    // (avoids breaking other modals that also use overflow:hidden)
    document.body.style.overflow = modal._prevBodyOverflow || '';
    document.body.classList.remove('cfp-search-active');

    // NOTE: We do NOT call closeThemeSearch() here.
    // The theme's search was already closed when we OPENED our modal.
    // Calling it on close would interfere with the theme re-opening its own
    // search if the user navigates away.
  }

  function closeThemeSearch() {
    // Close the theme's own search modal so ours can take over.
    // Strategy: layered approach from safest to broadest, all scoped to header.

    const headerEl = document.querySelector(
      'header, sticky-header, .site-header, #shopify-section-header'
    );

    // ── Layer 1: Shopify custom elements (always search, 100% safe) ──────────
    document.querySelectorAll('predictive-search, search-modal').forEach(el => {
      if (!el.id.includes('cfp-')) {
        el.style.display    = 'none';
        el.style.visibility = 'hidden';
        el.removeAttribute('open');
      }
    });

    // ── Layer 2: Close <details open> inside header with search class/id ─────
    if (headerEl) {
      headerEl.querySelectorAll('details[open]').forEach(details => {
        const cls = (details.className || '').toLowerCase();
        const id  = (details.id || '').toLowerCase();
        const hasSearchChild = details.querySelector('predictive-search, search-modal');
        if (cls.includes('search') || id.includes('search') || hasSearchChild) {
          details.removeAttribute('open');
        }
      });
    }

    // ── Layer 3: Close <dialog> by known exact IDs ───────────────────────────
    ['SearchModal', 'SearchDrawer', 'search-modal', 'search-drawer'].forEach(dialogId => {
      const dialog = document.getElementById(dialogId);
      if (dialog) {
        if (typeof dialog.close === 'function' && dialog.open) {
          try { dialog.close(); } catch (e) {}
        }
        dialog.style.display    = 'none';
        dialog.style.visibility = 'hidden';
      }
    });

    // ── Layer 4: Remove open/active classes from search components in header ──
    if (headerEl) {
      const searchComponents = [
        'search-modal', 'predictive-search',
        '.header__search', '.site-nav__search',
        '.search-modal', '.search-drawer', '.search-popup',
      ].join(', ');
      try {
        headerEl.querySelectorAll(searchComponents).forEach(el => {
          if (!el.id.includes('cfp-')) {
            el.classList.remove('active', 'is-active', 'open', 'is-open', 'is-visible');
          }
        });
      } catch (e) {}
    }

    // ── Layer 5: Reset inline styles on header search elements ───────────────
    if (headerEl) {
      const inlineTargets = [
        '.search-modal', '.search-drawer', '.search-popup',
        '.header__search', '#SearchDrawer', '#SearchModal',
      ].join(', ');
      try {
        headerEl.querySelectorAll(inlineTargets).forEach(el => {
          if (!el.id.includes('cfp-')) {
            if (el.style.display === 'block') el.style.display = '';
            if (el.style.opacity === '1')     el.style.opacity = '';
            if (el.style.visibility === 'visible') el.style.visibility = '';
          }
        });
      } catch (e) {}
    }

    // ── Layer 6: Remove KNOWN theme body classes for search-open state ────────
    // We only remove specific well-known class names, NOT any class with "search".
    // These are classes themes add to <body> when their search is open.
    const knownThemeSearchBodyClasses = [
      'search-open',        // common pattern
      'search-is-open',     // common pattern
      'js-search-open',     // common pattern
      'overlay-search',     // some themes
    ];
    knownThemeSearchBodyClasses.forEach(cls => {
      document.body.classList.remove(cls);
    });
  }



  function renderLoading(isLoading) {
    const loader = document.getElementById("cfp-search-loading");
    const body = document.getElementById("cfp-search-body");
    const productsGrid = document.getElementById("cfp-search-products");
    const collectionsList = document.getElementById("cfp-search-collections");
    
    loader.style.display = "none"; // Hide old spinner entirely
    if (isLoading) {
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
    const cacheKey = `cfp_instant_default_${shopDomain}_${instantCacheMarket()}`;
    const cached = readInstantCache(cacheKey);
    let hasCachedData = false;

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        renderRecentSearches("");
        renderCollections(parsed.collectionsData, "", true);
        await renderProducts(parsed.productsData, "", true, parsed.productsData ? parsed.productsData.contextualPricingApplied : false);
        hasCachedData = true;
      } catch (e) {}
    }

    if (!hasCachedData) {
      renderLoading(true);
    }

    try {
      let countryParam = "";
      if (window.Shopify && window.Shopify.country) {
         countryParam = `&country=${window.Shopify.country}`;
      }
      countryParam += `&locale=${encodeURIComponent(window.Shopify?.locale || '')}`;
      if (window.cfpCustomerTags) countryParam += `&customer_tags=${encodeURIComponent(window.cfpCustomerTags)}`;
      
      // 1. Fetch 4 popular products in background
      const productsPromise = fetchSearchJSON(
        `${CONFIG.apiUrl}?shop=${shopDomain}&limit=${CONFIG.productLimit}&sortBy=best-selling${countryParam}`
      );

      // 2. Fetch all/popular collections in background
      const rootUrl = window.Shopify && window.Shopify.routes ? window.Shopify.routes.root : "/";
      const collectionsPromise = CONFIG.collectionLimit === 0 ? Promise.resolve({collections:[]}) : fetch(`${rootUrl}collections.json?limit=${CONFIG.collectionLimit ?? 5}`)
        .then(res => {
           if(res.ok) return res.json();
           return fetch(`${rootUrl}search/suggest.json?q=a&resources[type]=collection&resources[limit]=${CONFIG.collectionLimit ?? 5}`).then(r => r.json());
        }).catch(() => ({collections:[]}));

      const [productsData, collectionsData] = await Promise.all([
        productsPromise,
        collectionsPromise,
      ]);

      // 3. Update Cache silently
      writeInstantCache(cacheKey, productsData, collectionsData);

      // 4. Update UI with fresh data if user hasn't typed anything yet
      const inputEl = document.getElementById("cfp-main-search-input");
      const currentQuery = inputEl ? inputEl.value : "";
      if (!currentQuery) {
        renderRecentSearches("");
        renderCollections(collectionsData, "", true);
        await renderProducts(productsData, "", true, productsData ? productsData.contextualPricingApplied : false);
      }

    } catch (error) {
      console.error("Instant Search Default View Error:", error);
      if (!hasCachedData && !mainInput.value.trim()) {
        document.getElementById("cfp-search-products").innerHTML = 
          `<div class="cfp-search-no-results">Unable to load trending products.</div>`;
        if (document.getElementById("cfp-search-collections")) {
           document.getElementById("cfp-search-collections").innerHTML = "";
        }
      }
    } finally {
      if (!hasCachedData && !mainInput.value.trim()) renderLoading(false);
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

    if (CONFIG.manualSuggestions?.length) { renderSuggestions(CONFIG.manualSuggestions, ''); return; }
    const searches = readRecentSearches();
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
            ${highlightSearchText(s, '')}
          </a>
          <button class="cfp-remove-recent-btn" data-query="${highlightSearchText(s, '')}" aria-label="Remove search">
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
    let searches = readRecentSearches();
    searches = searches.filter(q => q !== query);
    try { localStorage.setItem('cfp_recent_searches', JSON.stringify(searches)); } catch {}
    renderRecentSearches("");
  }

  function renderSuggestions(suggestions, query) {
    suggestions = suggestions.slice(0, query ? (CONFIG.suggestionLimit ?? 6) : 10);
    if (!suggestions.length) {
      const container = document.getElementById('cfp-recent-searches-container');
      if (container) container.style.display = 'none';
      return;
    }
    const container = document.getElementById("cfp-recent-searches-container");
    const list = document.getElementById("cfp-recent-searches-list");
    const collectionsTitle = document.getElementById("cfp-collections-title");
    
    if (container) container.style.display = "block";
    if (collectionsTitle) collectionsTitle.style.display = "none";

    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <div class="cfp-search-section-title" style="margin-bottom: 0;">Suggestions</div>
      </div>
    `;
    suggestions.forEach((s) => {
      // Highlight matching query
      const displayTitle = highlightSearchText(s, query);
      
      html += `
        <li class="cfp-recent-search-item">
          <a href="/search?q=${encodeURIComponent(s)}" class="cfp-recent-search-link">
            <svg class="cfp-history-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            ${displayTitle}
          </a>
        </li>
      `;
    });
    if(list) list.innerHTML = html;
  }

  async function performSearch(query) {
    document.getElementById("cfp-search-body").classList.add("cfp-has-results");
    const trimmedQuery = query.trim().toLowerCase();
    
    const cacheKey = `cfp_instant_search_${shopDomain}_${instantCacheMarket()}_${trimmedQuery}`;
    const cached = readInstantCache(cacheKey);
    let hasCachedData = false;

    renderRecentSearches(query);

    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        renderCollections(parsed.collectionsData, query);
        await renderProducts(parsed.productsData, query, false, parsed.productsData ? parsed.productsData.contextualPricingApplied : false);
        hasCachedData = true;
      } catch (e) {}
    }

    if (!hasCachedData) {
      renderLoading(true);
    }

    try {
      let countryParam = "";
      if (window.Shopify && window.Shopify.country) {
         countryParam = `&country=${window.Shopify.country}`;
      }

      // 1. Fetch products from OUR API in background
      countryParam += `&locale=${encodeURIComponent(window.Shopify?.locale || '')}`;
      if (window.cfpCustomerTags) countryParam += `&customer_tags=${encodeURIComponent(window.cfpCustomerTags)}`;
      const productsPromise = fetchSearchJSON(
        `${CONFIG.apiUrl}?shop=${shopDomain}&isSearch=true&searchType=instant&q=${encodeURIComponent(query)}&limit=${CONFIG.productLimit}&suggestionLimit=${CONFIG.suggestionLimit ?? 6}${countryParam}`
      );

      // 2. Fetch collections from Shopify Predictive Search API in background
      const rootUrl = window.Shopify && window.Shopify.routes ? window.Shopify.routes.root : "/";
      const collectionsPromise = CONFIG.collectionLimit === 0 ? Promise.resolve({resources:{results:{collections:[]}}}) : fetchSearchJSON(
        `${rootUrl}search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=collection&resources[limit]=${CONFIG.collectionLimit ?? 5}`
      ).catch(() => ({resources:{results:{collections:[]}}}));

      const [productsData, collectionsData] = await Promise.all([
        productsPromise,
        collectionsPromise,
      ]);

      // 3. Update Cache silently
      writeInstantCache(cacheKey, productsData, collectionsData);

      // 4. Update UI with fresh data if user hasn't changed query
      const inputEl = document.getElementById("cfp-main-search-input");
      const currentQuery = inputEl ? inputEl.value.trim().toLowerCase() : "";
      if (currentQuery === trimmedQuery) {
        
        // Did You Mean logic
        const dymContainer = document.getElementById("cfp-did-you-mean-container");
        if (dymContainer) {
          if (productsData && productsData.didYouMean && /^[a-z]{4,}$/i.test(query.trim())) {
            dymContainer.innerHTML = `${productsData.products?.length ? '' : `No matches found for '<strong>${highlightSearchText(query, '')}</strong>'. `}Did you mean '<a href="#" id="cfp-dym-link" style="font-weight: 700; text-decoration: underline; color: #0f172a;">${highlightSearchText(productsData.didYouMean, '')}</a>'?`;
            dymContainer.style.display = "block";
            
            document.getElementById("cfp-dym-link").addEventListener("click", (e) => {
              e.preventDefault();
              if (inputEl) {
                 inputEl.value = productsData.didYouMean;
                 inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                 inputEl.focus();
              }
            });
          } else {
            dymContainer.style.display = "none";
          }
        }

        renderCollections(collectionsData, query);
        if (productsData && productsData.suggestions && productsData.suggestions.length > 0) {
           renderSuggestions(productsData.suggestions, query);
        } else if (currentQuery.length > 0) {
           // Hide suggestions container if no suggestions
           const container = document.getElementById("cfp-recent-searches-container");
           if (container) container.style.display = "none";
        }
        await renderProducts(productsData, query, false, productsData ? productsData.contextualPricingApplied : false);
      }

    } catch (error) {
      console.error("Instant Search Error:", error);
      if (!hasCachedData && mainInput.value.trim().toLowerCase() === trimmedQuery) {
        document.getElementById("cfp-search-products").innerHTML = 
          `<div class="cfp-search-no-results">Something went wrong. Please try again.</div>`;
        document.getElementById("cfp-search-collections").innerHTML = "";
      }
    } finally {
      if (!hasCachedData && mainInput.value.trim().toLowerCase() === trimmedQuery) renderLoading(false);
    }
  }

  function renderCollections(data, query, isDefault = false) {
    const list = document.getElementById("cfp-search-collections");
    const titleElement = document.getElementById("cfp-collections-title");
    if (CONFIG.collectionLimit === 0) {
      if (list) list.innerHTML = '';
      if (titleElement) titleElement.style.display = 'none';
      return;
    }
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
            ${highlightSearchText(query, '')}
          </a>
        </li>
      `;
    }

    collections.slice(0, CONFIG.collectionLimit ?? 5).forEach((c) => {
      const collectionUrl = c.url || `/collections/${c.handle}`;
      const displayTitle = highlightSearchText(c.title, query);

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

  let marketRenderVersion = 0;
  const instantImagePlaceholder='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="100%" height="100%" fill="#f8fafc"/><text x="50%" y="50%" text-anchor="middle" fill="#64748b" font-family="sans-serif" font-size="16">Image unavailable</text></svg>');
  const instantEscapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const instantScriptString=value=>instantEscapeHtml(JSON.stringify(String(value??'')));
  function instantImageUrl(value){
    if(typeof value==='string')return value.trim();
    if(!value||typeof value!=='object')return '';
    return instantImageUrl(value.url||value.src||value.image);
  }
  function instantImages(value){
    if(typeof value==='string')try{value=JSON.parse(value);}catch{return [instantImageUrl(value)].filter(Boolean);}
    return (Array.isArray(value)?value:[value]).map(instantImageUrl).filter(Boolean);
  }
  async function renderProducts(data, query, isDefault = false, contextualPricingApplied = false) {
    if (data && data.globalSettings) {
      window.cfpGlobalSettings = data.globalSettings;
      window.cfpQuickViewInstance?.configure(data.globalSettings);
    }

    const grid = document.getElementById("cfp-search-products");
    const version = ++marketRenderVersion;
    const pricingProducts = data.products || [];
    const products = pricingProducts.map(p=>({...p,images:instantImages(p.images),
      merchandisingImage:instantImageUrl(p.merchandisingImage),
      variants:(p.variants||[]).filter(Boolean).map(v=>({...v,imageUrl:instantImageUrl(v.imageUrl)||instantImageUrl(v.image)})),_marketPricingUnavailable:true}));
    if (version !== marketRenderVersion) return;
    contextualPricingApplied = true;

    if (products.length === 0) {
      const emptyStateSvg = `<svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 16px;"><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path><line x1="3" y1="6" x2="21" y2="6"></line><path d="M16 10a4 4 0 0 1-8 0"></path><circle cx="9" cy="14" r="1" fill="#94a3b8"></circle><circle cx="15" cy="14" r="1" fill="#94a3b8"></circle><path d="M10 18c1-1 3-1 4 0"></path></svg>`;
      
      grid.innerHTML = query 
        ? `<div class="cfp-search-no-results" style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center; color: #475569; font-size: 15px;">
             ${emptyStateSvg}
             <p style="margin: 0;">No matches found for <strong>'${instantEscapeHtml(query)}'</strong>. Please try again with a different term.</p>
           </div>`
        : `<div class="cfp-search-no-results" style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; text-align: center; color: #475569; font-size: 15px;">
             ${emptyStateSvg}
             <p style="margin: 0;">No trending products found.</p>
           </div>`;
      return;
    }

    if (typeof window.pageDataMap !== 'undefined') {
      products.forEach(product => {
        let variantId = product.variants?.[0]?.id;
        if (variantId && typeof variantId === 'string') {
          variantId = variantId.toString().replace(/gid:\/\/shopify\/ProductVariant\//g, '');
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

        let fallbackImg = product.images?.[0];
        if (typeof fallbackImg === 'object' && fallbackImg !== null) {
            fallbackImg = fallbackImg.src || fallbackImg.url || '';
        }
        
        window.pageDataMap[product.handle] = {
           ...firstVariant,
           id: variantId,
           title: variantTitle || 'Default Title',
           price: price,
           compare_at_price: compareAtPrice,
           available: firstVariant.available !== false,
           product_id: productId,
           product_handle: product.handle,
           product_image: product.merchandisingImage || fallbackImg,
           product_title: product.title
        };
      });
    }

    let html = "";
    
    // Resize shopify image URL to avoid massive memory usage on storefront
    const getResizedImageUrl = (value, size = '600x') => {
       const raw=instantImageUrl(value);if(!raw)return '';
       try{
         const url=new URL(raw,location.href);
         if(url.hostname==='cdn.shopify.com'||url.pathname.startsWith('/cdn/shop/')){
           url.searchParams.set('width',String(parseInt(size,10)||600));return url.href;
         }
       }catch{}
       return raw;
    };

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
      let defaultVariantId = "";
      let hasMatchedColor = false;
      
      if (colorOptionIndex !== -1 && p.variants && p.variants.length > 0) {
        const optionKey = `option${colorOptionIndex + 1}`; // option1, option2, or option3
        const uniqueColors = new Map();

        p.variants.forEach(v => {
          const colorName = v[optionKey];
          // We only take variants with images for swatches
          if (colorName && !uniqueColors.has(colorName) && v.imageUrl) {
            const numericId = v.id ? v.id.toString().replace(/gid:\/\/shopify\/ProductVariant\//g, '') : '';
            uniqueColors.set(colorName, { imgUrl: v.imageUrl, variantId: numericId });
          }
        });

        if (uniqueColors.size > 0) {
          swatchesHtml += `<div class="cfp-product-swatches">`;
          const colorsArray = Array.from(uniqueColors.entries());
          
          let activeIndex = 0;
          if (query) {
             const q = query.toLowerCase();
             const foundIndex = colorsArray.findIndex(c => c[0].toLowerCase().includes(q) || q.includes(c[0].toLowerCase()));
             if (foundIndex !== -1) {
                activeIndex = foundIndex;
                hasMatchedColor = true;
             }
          }

          if (p.selectedVariantId) {
            const selected = (p.variants || []).find(v => String(v.id).split('/').pop() === String(p.selectedVariantId).split('/').pop());
            const selectedIndex = colorsArray.findIndex(c => c[0] === selected?.[optionKey]);
            if (selectedIndex >= 0) { activeIndex = selectedIndex; hasMatchedColor = true; }
          }
          defaultImageUrl = colorsArray[activeIndex][1].imgUrl;
          if (colorsArray[activeIndex][1].variantId) {
             defaultVariantId = colorsArray[activeIndex][1].variantId;
          }
          
          colorsArray.forEach(([colorName, data], index) => {
             const isHidden = index >= 5 ? 'cfp-swatch-hidden' : '';
             const isActive = index === activeIndex ? 'cfp-swatch-active' : '';
             
             let hoverImgUrlForSwatch = '';
             if (window.cfpGlobalSettings && window.cfpGlobalSettings.secondImageOnHover !== false && Array.isArray(p.images) && data.imgUrl) {
                 const targetUrlBase = data.imgUrl.split('?')[0].replace(/^https?:/, '');
                 let foundIdx = -1;
                 for (let i=0; i<p.images.length; i++) {
                     let src = typeof p.images[i] === 'object' ? p.images[i].src : p.images[i];
                     if (src && (src.includes(targetUrlBase) || targetUrlBase.includes(src.split('?')[0].replace(/^https?:/, '')))) {
                         foundIdx = i;
                         break;
                     }
                 }
                 if (foundIdx !== -1 && foundIdx + 1 < p.images.length) {
                     let nextImg = p.images[foundIdx + 1];
                     let nextImgSrc = typeof nextImg === 'object' ? nextImg.src : nextImg;
                     
                     let isVariantImage = false;
                     if (p.variants) {
                         const nextUrlBase = nextImgSrc.split('?')[0].replace(/^https?:/, '');
                         isVariantImage = p.variants.some(v => v.imageUrl && (v.imageUrl.includes(nextUrlBase) || nextUrlBase.includes(v.imageUrl.split('?')[0].replace(/^https?:/, ''))));
                     }
                     if (!isVariantImage) {
                         hoverImgUrlForSwatch = nextImgSrc;
                     }
                 }
             }

             const secondaryImgJS = `
               const secImg = card.querySelector('.cfp-secondary-img');
               if (secImg) {
                   ${hoverImgUrlForSwatch ? `secImg.src=${instantScriptString(getResizedImageUrl(hoverImgUrlForSwatch, '600x'))}; secImg.style.display='';` : `secImg.style.display='none';`}
               }
             `;
             
             // We use onmouseenter for instant preview and onclick for selection.
             swatchesHtml += `<div class="cfp-swatch-item ${isActive} ${isHidden}" 
                  data-tooltip="${instantEscapeHtml(colorName)}"
                  onclick="event.preventDefault(); 
                           const card = this.closest('.cfp-product-card');
                           card.querySelector('.cfp-main-img').src=${instantScriptString(getResizedImageUrl(data.imgUrl, '600x'))};
                           ${secondaryImgJS.replace(/\n/g, ' ')}
                           const swatches = this.closest('.cfp-product-swatches').querySelectorAll('.cfp-swatch-item');
                           swatches.forEach(s => s.classList.remove('cfp-swatch-active'));
                           this.classList.add('cfp-swatch-active');
                           if(${instantScriptString(data.variantId)}) card.querySelectorAll('a.cfp-search-product-card').forEach(link=>link.href=${instantScriptString('/products/'+p.handle+'?variant='+data.variantId)});">
                <img src="${instantEscapeHtml(getResizedImageUrl(data.imgUrl, '50x'))}" alt="${instantEscapeHtml(colorName)}" />
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
      const selectedVariant=(p.variants||[]).find(v=>String(v.id).split('/').pop()===String(p.selectedVariantId||'').split('/').pop());
      if (p.selectedVariantId) {
        defaultVariantId = String(p.selectedVariantId).split('/').pop();
        if (p.searchColor) defaultImageUrl = instantImageUrl(p.searchColorImage)||selectedVariant?.imageUrl||'';
      }
      const sameColorImages=p.searchColor?(p.variants||[]).filter(v=>String(v[`option${colorOptionIndex+1}`]||'').trim().toLowerCase()===String(p.searchColor).trim().toLowerCase()).map(v=>v.imageUrl).filter(Boolean):[];
      if (p.searchColor) {
        imageUrl = instantImageUrl(p.searchColorImage)||selectedVariant?.imageUrl||sameColorImages[0]||'';
      } else if (p.merchandisingImage) {
        imageUrl = p.merchandisingImage;
      } else if (defaultImageUrl) {
        // Always use the swatch image corresponding to the activeIndex
        imageUrl = defaultImageUrl;
      } else {
        imageUrl=selectedVariant?.imageUrl||p.images[0]||instantImageUrl(p.featuredImage)||instantImageUrl(p.image)||(p.variants||[]).find(v=>v.imageUrl)?.imageUrl||'';
      }

      // Color-intent results may only fall back to that color's images.
      const imageCandidates=[...new Set([imageUrl,...(p.searchColor?sameColorImages:[...p.images,selectedVariant?.imageUrl,instantImageUrl(p.featuredImage),instantImageUrl(p.image),...(p.variants||[]).map(v=>v.imageUrl)])].filter(Boolean).map(url=>getResizedImageUrl(url,'600x')))];
      imageCandidates.push(instantImagePlaceholder);
      imageUrl=imageCandidates.shift();

      const rate = 1; // Shopify storefront prices already include the visitor's market.
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
      
      let price = "";
      if (p.priceMin !== undefined) {
         let priceVal = parseFloat(p.priceMin) * rate;
         price = `${symbol}${priceVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      let productUrl = `/products/${p.handle}`;
      if (defaultVariantId) {
         productUrl += `?variant=${defaultVariantId}`;
      }

      let wishlistHtml = '';

      if (typeof window.pageDataMap !== 'undefined' && data.globalSettings && data.globalSettings.integrations && data.globalSettings.integrations.wishlist === true) {
        wishlistHtml = `<div class="wishlist-btn-container" data-product-id="${p.handle}" style="position: absolute; top: 10px; right: 10px; z-index: 2;">
             <button type="button" class="wishlist-toggle-btn" style="background: transparent; border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; outline: none; box-shadow: none;">
                <svg class="wishlist-icon-svg" style="overflow: visible;" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#121212" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19.6706 5.4736C17.6806 3.8336 14.7206 4.1236 12.8906 5.9536L12.0006 6.8436L11.1106 5.9536C9.29063 4.1336 6.32064 3.8336 4.33064 5.4736C2.05064 7.3536 1.93063 10.7436 3.97063 12.7836L11.6406 20.4536C11.8406 20.6536 12.1506 20.6536 12.3506 20.4536L20.0206 12.7836C22.0706 10.7436 21.9506 7.3636 19.6706 5.4736Z"></path></svg>
             </button>
          </div>`;
      }

      let hoverImageHtml = '';
      if (!p.searchColor && data.globalSettings && data.globalSettings.secondImageOnHover !== false && p.images.length > 1) {
        let hoverImg = p.images[1];
        let hoverImgSrc = typeof hoverImg === 'object' && hoverImg.src ? hoverImg.src : hoverImg;
        if (typeof hoverImgSrc === 'string' && hoverImgSrc) {
           hoverImageHtml = `<img src="${instantEscapeHtml(getResizedImageUrl(hoverImgSrc, '600x'))}" alt="${instantEscapeHtml(p.title)}" class="cfp-secondary-img" loading="lazy" />`;
        }
      }

      html += `
        <div class="cfp-product-card cfp-search-result-card" style="position:relative; width: 100%;">
          <div class="cfp-search-product-image-wrapper" style="position: relative;">
            <a href="${instantEscapeHtml(productUrl)}" class="cfp-search-product-card" style="display:block; width:100%; text-decoration:none; color:inherit;">
              <div class="cfp-search-product-image-wrap">
                <img src="${instantEscapeHtml(imageUrl)}" data-cfp-image-fallbacks="${instantEscapeHtml(JSON.stringify(imageCandidates))}" alt="${instantEscapeHtml(p.title)}" class="cfp-main-img" />
                ${hoverImageHtml}
                ${wishlistHtml}
              </div>
            </a>
            ${(data.globalSettings && data.globalSettings.showQuickViewInstantSearch !== false) ? `<button type="button" class="cfp-quick-view-btn" data-cfp-quick-view-context="instant-search" data-product-handle="${instantEscapeHtml(p.handle)}">Quick View</button>` : ''}
          </div>
          <a href="${instantEscapeHtml(productUrl)}" class="cfp-search-product-card" style="display:block; width:100%; text-decoration:none; color:inherit;">
            <div class="cfp-search-product-title" style="margin-top: 12px; font-size: 14px; font-weight: 500; text-align: center;">${instantEscapeHtml(p.title)}</div>
            ${swatchesHtml}
            ${(data.globalSettings && data.globalSettings.isWholesale && !window.cfpCustomerLoggedIn) ? '' : `
            <div class="cfp-search-product-price" style="margin-top: 8px; text-align: center;">${p._marketPricingUnavailable ? "See product price" : price}</div>
            `}
          </a>
        </div>
      `;
    });

    grid.innerHTML = html;
    grid.querySelectorAll('img.cfp-main-img,img.cfp-secondary-img').forEach(image=>{
      const fallbacks=JSON.parse(image.dataset.cfpImageFallbacks||'[]');
      image.addEventListener('load',()=>image.classList.add('cfp-image-ready'));
      if(image.complete&&image.naturalWidth>0)image.classList.add('cfp-image-ready');
      image.addEventListener('error',()=>{
        image.classList.remove('cfp-image-ready');
        if(image.classList.contains('cfp-secondary-img')){image.remove();return;}
        const next=fallbacks.shift();if(next)image.src=next;
      });
    });
    const cards = Array.from(grid.querySelectorAll('.cfp-product-card'));
    window.cfpMarketPricing?.apply(pricingProducts, (product, index) => {
      const card = cards[index];
      if (version !== marketRenderVersion || !card?.isConnected || product._marketPricingUnavailable) return;
      const price = card.querySelector('.cfp-search-product-price');
      if (!price) return;
      const selected = new URL(card.querySelector('a')?.href || location.href).searchParams.get('variant');
      const variant = product.variants?.find(v => String(v.id).split('/').pop() === selected);
      price.textContent = new Intl.NumberFormat('en-US', {style:'currency',currency:window.Shopify?.currency?.active || 'USD'}).format(variant?.price ?? product.priceMin);
    }).catch(() => {});
  }
});




