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

document.addEventListener("DOMContentLoaded", function () {
  const searchSettings = window.cfpSearchSettings || {};
  // Config
  const userSettings = window.CFP_InstantSearchSettings || {};
  const CONFIG = {
    minChars: searchSettings.minChars ?? 2,
    debounceTime: 250,
    productLimit: searchSettings.productLimit ?? (userSettings.productLimit || 6),
    suggestionLimit: searchSettings.suggestionLimit ?? 6,
    collectionLimit: searchSettings.collectionLimit ?? 5,
    recentLimit: searchSettings.recentLimit ?? 4,
    manualSuggestions: searchSettings.manualSuggestions || [],
    customSelector: searchSettings.searchBoxSelector || userSettings.customTriggerSelector || "",
    enabled:searchSettings.instantSearchEnabled!==false,showPages:searchSettings.showPages===true,pageLimit:searchSettings.pageLimit??3,
    showPopularProducts:searchSettings.instantLayout==='compact'?searchSettings.showPopularProducts!==false:true,popularProductLimit:searchSettings.instantLayout==='compact'?(searchSettings.popularProductLimit??(searchSettings.productLimit??6)):(searchSettings.emptySearchProducts?.length||6),
    apiUrl: `${API_DOMAIN}/api/search`,
  };

  const shopDomain = window.Shopify ? window.Shopify.shop : "";
  function commitInstantSearch() {
    const searchId = window.cfpActiveInstantSearchId;
    const query = window.cfpActiveInstantSearchQuery;
    if (!searchId || !query || window.cfpCommittedInstantSearchId === searchId) return;
    if (!window.CfpAnalytics?.track('search_query', { search_id: searchId, q: query,
      hits: window.cfpActiveInstantSearchHits || 0 })) return;
    window.cfpCommittedInstantSearchId = searchId;
    if (window.cfpActiveInstantSearchHits === 0)
      window.CfpAnalytics.track('zero_result', { search_id: searchId });
  }
  document.addEventListener('click', event => {
    const card = event.target.closest('.cfp-search-result-card[data-cfp-product-id]');
    const searchId = window.cfpActiveInstantSearchId;
    if (!card || !searchId) return;
    commitInstantSearch();
    const details = { search_id: searchId, product_id: card.dataset.cfpProductId,
      position: Number(card.dataset.cfpPosition) };
    if (event.target.closest('a.cfp-search-product-card')) window.CfpAnalytics?.track('result_click', details);
    else if (event.target.closest('.cfp-quick-view-btn')) window.CfpAnalytics?.track('quick_view', details);
  });


  // Search caching must never replay products from before a merchant save.
  async function refreshSearchConfiguration(options) {
    await window.cfpRefreshSearchSettings?.(options);
    const settings = window.cfpSearchSettings || {};
    Object.assign(CONFIG, {
      minChars: settings.minChars ?? 2,
      productLimit: settings.productLimit ?? (window.CFP_InstantSearchSettings?.productLimit || 6),
      suggestionLimit: settings.suggestionLimit ?? 6,
      collectionLimit: settings.collectionLimit ?? 5,
      recentLimit: settings.recentLimit ?? 4,
      manualSuggestions: settings.manualSuggestions || [],
      enabled:settings.instantSearchEnabled!==false,showPages:settings.showPages===true,pageLimit:settings.pageLimit??3,
      showPopularProducts:settings.instantLayout==='compact'?settings.showPopularProducts!==false:true,popularProductLimit:settings.instantLayout==='compact'?(settings.popularProductLimit??(settings.productLimit??6)):(settings.emptySearchProducts?.length||6),
      customSelector:settings.searchBoxSelector||window.CFP_InstantSearchSettings?.customTriggerSelector||'',
    });
    applySearchDisplaySettings();
  }

  async function fetchSearchJSON(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Search request failed: ' + response.status);
    return response.json();
  }

  function highlightSearchText(value, query) {
    const escape = text => String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    if (!query?.trim()) return escape(value);
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return String(value).split(new RegExp('(' + escapedQuery + ')', 'gi')).map((part, index) => index % 2 ? '<strong>' + escape(part) + '</strong>' : escape(part)).join('');
  }

  function cleanSuggestionText(value) {
    if (typeof value !== 'string') return '';
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text || text.length > 300) return '';
    const probe = text.replace(/&(?:amp;)*lt;|&#0*60;|&#x0*3c;/gi, '<').replace(/&(?:amp;)*gt;|&#0*62;|&#x0*3e;/gi, '>');
    if (/<\/?[a-z][^>]*>|<!--|<!doctype\b/i.test(probe) || /\b(?:document|window)\s*\.\s*(?:write|getElementById|createElement|addEventListener)\s*\(/i.test(probe)) return '';
    return text;
  }

  // UI Elements
  let modal = null;
  let overlay = null;
  let mainInput = null;
  let compactTab = 0;
  let compactPage = 0;
  let compactConfig = '';
  let pendingOpen = null;

  // Initialize
  // Let the local rendering state initialize before creating the modal.
  Promise.resolve().then(init);

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
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-label', 'Search');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="cfp-search-header">
        <div class="cfp-search-input-wrapper">
          <svg class="cfp-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="cfp-main-search-input" aria-label="Search products" placeholder="Search for..." autocomplete="off" />
          <button type="button" id="cfp-compact-search-clear" class="cfp-compact-clear-btn" aria-label="Clear search" style="display:none" hidden><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 5 14 14M19 5 5 19"/></svg></button>
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

      <div id="cfp-compact-tabs" class="cfp-compact-tabs" role="tablist" aria-label="Main collections" hidden></div>
      <div class="cfp-search-body" id="cfp-search-body">
        <div class="cfp-search-column-left">
          <div id="cfp-full-results-header" class="cfp-full-results-header" hidden><h2 id="cfp-full-results-heading">Products</h2></div>
          <div id="cfp-full-category-tabs" class="cfp-full-category-tabs" role="tablist" aria-label="Search collections" hidden></div>
          <div class="cfp-search-section-title" id="cfp-compact-products-title" style="display:none" hidden>Products</div>
          <div class="cfp-search-product-grid" id="cfp-search-products">
            <!-- Products will be rendered here -->
          </div>
          <a id="cfp-view-all-results" class="cfp-view-all-results" hidden></a>

        </div>
        <div class="cfp-search-column-right">
          <div id="cfp-recent-searches-container" style="display: none; margin-bottom: 30px;">
            <ul class="cfp-recent-searches-list" id="cfp-recent-searches-list">
              <!-- Recent searches rendered here -->
            </ul>
          </div>
          <div id="cfp-compact-browse" hidden></div>
          <div class="cfp-search-section-title" id="cfp-collections-title">Collections</div>
          <ul class="cfp-search-collections-list" id="cfp-search-collections">
            <!-- Collections will be rendered here -->
          </ul>
          <div id="cfp-full-popular" class="cfp-full-popular" hidden><div class="cfp-search-section-title">Popular searches</div><div id="cfp-full-popular-chips"></div></div>
          <div class="cfp-search-section-title" id="cfp-pages-title" style="display:none">Pages</div>
          <ul class="cfp-search-collections-list" id="cfp-search-pages" style="display:none"></ul>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    mainInput = document.getElementById("cfp-main-search-input");
    applySearchDisplaySettings();
  }

  function applySearchDisplaySettings(){
    if(!modal)return;
    const settings=window.cfpSearchSettings||{};
    modal.dataset.cfpLayout=settings.instantLayout==='compact'?'compact':'fullscreen';
    modal.dataset.cfpProductColumn=settings.productColumn||'left';
    modal.style.setProperty('--cfp-instant-columns',String(settings.instantColumns||4));
    overlay.dataset.cfpLayout=modal.dataset.cfpLayout;
    const full=modal.dataset.cfpLayout==='fullscreen',header=document.getElementById('cfp-full-results-header'),link=document.getElementById('cfp-view-all-results');
    header.hidden=!full;
    (full?header:document.querySelector('.cfp-search-column-left')).appendChild(link);
    if(!full){if(fullNavigation.query)resetFullNavigation();}
    else renderPopularSearches();
    renderCompactNavigation();
    positionCompactPanel();
  }

  function positionCompactPanel() {
    if (!modal) return;
    if (modal.dataset.cfpLayout !== 'compact') {
      for (const key of ['left','right','bottom','width','max-height','transform-origin','--cfp-compact-panel-width','--cfp-compact-panel-height','--cfp-compact-pointer-x']) modal.style.removeProperty(key);
      modal.style.top='0px';delete modal.dataset.cfpPlacement;delete modal.dataset.cfpAnchored;
      return;
    }
    const viewport=window.visualViewport;
    const x=viewport?.offsetLeft||0,y=viewport?.offsetTop||0;
    const viewportWidth=viewport?.width||window.innerWidth,viewportHeight=viewport?.height||window.innerHeight;
    const margin=8,gap=12,width=Math.min(448,Math.max(0,viewportWidth-margin*2));
    const icon=modal._trigger?.querySelector?.('svg'),iconRect=icon?.getBoundingClientRect();
    const bounds=iconRect?.width&&iconRect?.height?iconRect:modal._trigger?.getBoundingClientRect();
    const anchor=bounds?.width&&bounds?.height&&bounds.bottom>y&&bounds.top<y+viewportHeight&&bounds.right>x&&bounds.left<x+viewportWidth?bounds:null;
    const centerX=anchor?anchor.left+anchor.width/2:x+viewportWidth-32;
    const left=Math.max(x+margin,Math.min(centerX-width+24,x+viewportWidth-width-margin));
    const anchorBottom=anchor?.bottom??(y+(viewportWidth<=600?50:100));
    const anchorTop=anchor?.top??anchorBottom;
    const below=Math.max(0,y+viewportHeight-margin-anchorBottom-gap),above=Math.max(0,anchorTop-gap-y-margin);
    const opensAbove=below<Math.min(240,viewportHeight-margin*2)&&above>below;
    const height=Math.min(600,opensAbove?above:below);
    const pointerX=Math.max(18,Math.min(centerX-left,width-18));
    modal.dataset.cfpPlacement=opensAbove?'above':'below';
    modal.dataset.cfpAnchored=String(!!anchor);
    modal.style.left=left+'px';modal.style.right='auto';modal.style.width=width+'px';
    modal.style.top=opensAbove?'auto':Math.min(anchorBottom+gap,y+viewportHeight-margin)+'px';
    modal.style.bottom=opensAbove?window.innerHeight-anchorTop+gap+'px':'auto';
    modal.style.maxHeight=height+'px';
    modal.style.setProperty('--cfp-compact-panel-width',width+'px');
    modal.style.setProperty('--cfp-compact-panel-height',height+'px');
    modal.style.setProperty('--cfp-compact-pointer-x',pointerX+'px');
    modal.style.transformOrigin=pointerX+'px '+(opensAbove?'100%':'0px');
  }

  function renderCompactNavigation() {
    const settings = window.cfpSearchSettings || {};
    const tabs = document.getElementById('cfp-compact-tabs');
    const browse = document.getElementById('cfp-compact-browse');
    if (!tabs || !browse) return;
    const collections = settings.compactCollections || [];
    const config = JSON.stringify(collections);
    if (config !== compactConfig) { compactConfig = config; compactTab = 0; compactPage = 0; }
    const isCompact = settings.instantLayout === 'compact';
    const hasInput = !!mainInput.value.trim();
    const hasQuery = mainInput.value.trim().length >= CONFIG.minChars;
    const enabled = isCompact && collections.length > 0;
    const active = enabled && !hasQuery;
    modal.dataset.cfpSearching = String(isCompact && hasQuery);
    document.getElementById('cfp-compact-search-clear').hidden = !(isCompact && hasInput);
    document.getElementById('cfp-compact-products-title').hidden = !(isCompact && hasQuery);
    modal.dataset.cfpBrowsing = String(active);
    tabs.hidden = !enabled; browse.hidden = !active;
    if (isCompact && !hasQuery) document.getElementById('cfp-did-you-mean-container').style.display = 'none';
    if (!enabled) return;
    compactTab = Math.min(compactTab, collections.length - 1);
    tabs.innerHTML = collections.map((c,i) => `<button type="button" role="tab" id="cfp-compact-tab-${i}" aria-selected="${i === compactTab}" aria-controls="cfp-compact-browse" tabindex="${i === compactTab ? 0 : -1}">${highlightSearchText(c.tabLabel?.trim() || c.title,'')}</button>`).join('');
    const selectTab = index => { compactTab = index; compactPage = 0; renderCompactNavigation(); };
    tabs.querySelectorAll('button').forEach((button,i) => {
      button.addEventListener('click', () => { selectTab(i); tabs.querySelectorAll('button')[i].focus(); });
      button.addEventListener('keydown', event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? collections.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + collections.length) % collections.length;
        selectTab(index); tabs.querySelectorAll('button')[index].focus();
      });
    });
    if (!active) return;
    const main = collections[compactTab];
    const groups = main.groups || [];
    const pageCount = Math.max(1, ...groups.map(g => Math.ceil(g.collections.length / 4)));
    compactPage = Math.min(compactPage, pageCount - 1);
    const root = window.Shopify?.routes?.root || '/';
    const link = c => root + 'collections/' + encodeURIComponent(c.handle);
    browse.setAttribute('role','tabpanel');
    browse.setAttribute('aria-labelledby','cfp-compact-tab-' + compactTab);
    browse.style.setProperty('--cfp-compact-rank-start', String(compactPage * 4));
    browse.innerHTML = `<div class="cfp-compact-columns">${groups.map(group => `<section><h3>${highlightSearchText(group.title,'')}</h3><ol start="${compactPage * 4 + 1}">${group.collections.slice(compactPage * 4, compactPage * 4 + 4).map(c => `<li><a href="${link(c)}">${c.image ? `<img src="${highlightSearchText(c.image,'')}" alt="" loading="lazy" width="42" height="64">` : '<span class="cfp-compact-image-placeholder" aria-hidden="true"></span>'}<span>${highlightSearchText(c.title,'')}</span></a></li>`).join('')}</ol></section>`).join('')}</div>
      ${pageCount > 1 ? `<div class="cfp-compact-pagination"><button type="button" data-page="-1" ${compactPage === 0 ? 'disabled' : ''}>‹ Previous</button><span aria-live="polite">${compactPage + 1} / ${pageCount}</span><button type="button" data-page="1" ${compactPage + 1 >= pageCount ? 'disabled' : ''}>Next ›</button></div>` : ''}`;
    browse.querySelectorAll('img').forEach(img => {
      const hideBrokenImage = () => {
        const placeholder = document.createElement('span');
        placeholder.className = 'cfp-compact-image-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        img.replaceWith(placeholder);
      };
      img.addEventListener('error', hideBrokenImage, { once: true });
      if (img.complete && !img.naturalWidth) hideBrokenImage();
    });
    browse.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
      const direction = button.dataset.page;
      compactPage += Number(direction); renderCompactNavigation();
      const next = browse.querySelector(`[data-page="${direction}"]`);
      (next?.disabled ? browse.querySelector('[data-page]:not(:disabled)') : next)?.focus();
    }));
  }

  function attachListeners() {
      window.addEventListener('resize', positionCompactPanel);
      window.addEventListener('scroll', positionCompactPanel, {passive:true});
      window.visualViewport?.addEventListener('resize', positionCompactPanel);
      window.visualViewport?.addEventListener('scroll', positionCompactPanel);
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
        if (modal?._nativeFallback) return;
        if(window.cfpSearchSettings?.instantSearchEnabled===false)return;
        // ── GATE 0: Ignore events inside our own modal/overlay ───────────────
        if (e.target.closest('.cfp-search-modal, .cfp-search-modal-overlay, [data-cfp-inline="true"].cfp-search-header')) return;

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
        if (modal?._nativeFallback) return;
        if(window.cfpSearchSettings?.instantSearchEnabled===false)return;
        const el = e.target;
        if (!el) return;
        if (modal?._restoringFocus) return;
        if (el.tagName !== 'INPUT') return;                           // Only input elements
        if (el.type !== 'search' && el.name !== 'q') return;         // Only search inputs
        if (el.closest('.cfp-search-modal, .cfp-search-header[data-cfp-inline="true"]')) return;
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
    document.getElementById('cfp-compact-search-clear').addEventListener('click', () => {
      mainInput.value = '';
      mainInput.dispatchEvent(new Event('input', { bubbles: true }));
      mainInput.focus();
    });
    overlay.addEventListener("click", closeModal);
    document.addEventListener('pointerdown', e => {
      if (pendingOpen && !pendingOpen.trigger?.contains(e.target)) closeModal();
      if (modal.dataset.cfpLayout === 'compact' && modal.classList.contains('cfp-open') && !modal.contains(e.target) && !modal._trigger?.contains(e.target)) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (document.querySelector('.cfp-native-quick-view[open]')) return;
      if (e.key === 'Tab' && modal.dataset.cfpLayout === 'compact' && modal.classList.contains('cfp-open')) {
        const controls = [...modal.querySelectorAll('button:not(:disabled),input,a[href]')].filter(el => el.tabIndex >= 0 && el.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
      if (e.key === "Escape" && (pendingOpen || modal.classList.contains("cfp-open"))) {
        closeModal();
      }
    });

    // 3. Main Input Listener
    let debounceTimer;
    mainInput.addEventListener("input", (e) => {
      const query = e.target.value.trim();
      clearTimeout(debounceTimer);
      clearTimeout(fullNavigationTimer);fullSearchVersion++;
      if(query.length<CONFIG.minChars&&fullNavigation.query)resetFullNavigation();
      window.cfpActiveInstantSearchId = null;
      window.cfpActiveInstantSearchQuery = null;

      if (!query) {
        mainInput._cfpQueryActive = false;
        renderCompactNavigation();
        fetchDefaultView();
        return;
      }

      if (query.length < CONFIG.minChars) {
        // Keep the initial view steady while the customer is still typing.
        // Leaving a previous search clears it once, without another request.
        if (mainInput._cfpQueryActive) {
          mainInput._cfpQueryActive = false;
          renderLoading(false);
          document.getElementById('cfp-search-body').classList.remove('cfp-has-results');
          const viewAll = document.getElementById('cfp-view-all-results');
          if (viewAll) viewAll.hidden = true;
          renderCompactNavigation();
        }
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
          window.location.href = window.cfpSearchResultUrl?.(query)||`/search?q=${encodeURIComponent(query)}`;
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
    if (modal.classList.contains('cfp-open') || pendingOpen) return;
    let trigger = triggerElement?.closest?.('button,a,summary,input,[role="button"]') || triggerElement;
    const nativeSearch = trigger?.closest?.('header-search, search-modal, #SearchModal, #SearchDrawer, #search-modal, #search-drawer');
    if (nativeSearch?.id) {
      trigger = [...document.querySelectorAll('a[aria-controls],button[aria-controls],summary[aria-controls]')].find(el =>
        !nativeSearch.contains(el) && el.getAttribute('aria-controls').split(/\s+/).includes(nativeSearch.id)) || trigger;
    }
    const request = { trigger, busy: trigger?.getAttribute('aria-busy') };
    pendingOpen = request;
    document.body.classList.add('cfp-search-pending');
    closeThemeSearch();
    trigger?.setAttribute('aria-busy', 'true');
    return openConfiguredModal(request);
  }

  function restorePendingTrigger(request) {
    if (request.busy === null) request.trigger?.removeAttribute('aria-busy');
    else if (request.busy !== undefined) request.trigger?.setAttribute('aria-busy', request.busy);
  }

  async function openConfiguredModal(request) {
    await window.cfpSearchSettingsReady;
    if (pendingOpen !== request) return;
    await refreshSearchConfiguration({timeoutMs:5000});
    if (pendingOpen !== request) return;
    pendingOpen = null;
    restorePendingTrigger(request);
    if (CONFIG.enabled === false) {
      document.body.classList.remove('cfp-search-pending');
      modal._nativeFallback = true;
      try { request.trigger?.click(); } finally { modal._nativeFallback = false; }
      return;
    }

    modal._trigger = request.trigger;
    modal.style.top = '0px';
    applySearchDisplaySettings();
    if (modal.dataset.cfpLayout === 'compact') {
      // Settle the anchored position before the first opening transition.
      modal.style.setProperty('transition','none','important');
      void modal.offsetWidth;
      modal.style.removeProperty('transition');
      void modal.offsetWidth;
    }
    overlay.classList.add('cfp-open');
    modal.classList.add('cfp-open');
    closeThemeSearch();
    document.body.classList.remove('cfp-search-pending');

    // Prevent background scrolling.
    // Save any existing overflow value so we can restore it precisely on close.
    modal._prevBodyOverflow = document.body.style.overflow;
    // Keep the existing scrollbar space while the compact popup locks scrolling.
    // Otherwise fixed header icons move when the page scrollbar disappears.
    const root = document.documentElement;
    if (modal.dataset.cfpLayout === 'compact' && window.innerWidth > root.clientWidth && getComputedStyle(root).scrollbarGutter === 'auto') {
      modal._compactScrollGutter = [root.style.getPropertyValue('scrollbar-gutter'), root.style.getPropertyPriority('scrollbar-gutter')];
      root.style.setProperty('scrollbar-gutter', 'stable');
    }
    document.body.style.overflow = 'hidden';
    document.body.classList.add('cfp-search-active');
    if (modal.dataset.cfpLayout === 'compact') positionCompactPanel();

    // Load default view if input is empty
    if (mainInput.value.trim().length === 0) {
      fetchDefaultView(true);
    }

    // Focus the input after transition
    setTimeout(() => { if (modal.classList.contains('cfp-open')) mainInput.focus({preventScroll:true}); }, 100);
  }

  function closeModal() {
    clearTimeout(fullNavigationTimer);
    if (pendingOpen) {
      restorePendingTrigger(pendingOpen);
      pendingOpen = null;
      document.body.classList.remove('cfp-search-pending');
      closeNativeHeaderSearch();
    }
    if (!modal.classList.contains('cfp-open')) return; // Already closed
    closeNativeHeaderSearch();

    overlay.classList.remove('cfp-open');
    modal.classList.remove('cfp-open');

    // Restore body overflow to what it was before we set it
    // (avoids breaking other modals that also use overflow:hidden)
    document.body.style.overflow = modal._prevBodyOverflow || '';
    if (modal._compactScrollGutter) {
      const [value, priority] = modal._compactScrollGutter;
      if (value) document.documentElement.style.setProperty('scrollbar-gutter', value, priority);
      else document.documentElement.style.removeProperty('scrollbar-gutter');
      modal._compactScrollGutter = null;
    }
    document.body.classList.remove('cfp-search-active');
    if (modal.dataset.cfpLayout === 'compact' && modal._trigger?.isConnected) {
      // Avoid the theme-input focus listener reopening the panel on close.
      modal._restoringFocus = true;
      modal._trigger.focus?.({ preventScroll: true });
      modal._restoringFocus = false;
    }

    // NOTE: We do NOT call closeThemeSearch() here.
    // The theme's search was already closed when we OPENED our modal.
    // Calling it on close would interfere with the theme re-opening its own
    // search if the user navigates away.
  }

  function closeNativeHeaderSearch() {
    document.querySelectorAll('header-search').forEach(el => {
      if (el.hasAttribute('open') && typeof el.hide === 'function') {
        try { Promise.resolve(el.hide()).catch(() => {}); } catch {}
      }
      el.removeAttribute('open');
    });
  }

  function closeThemeSearch() {
    // Close the theme's own search modal so ours can take over.
    // Strategy: layered approach from safest to broadest, all scoped to header.

    const headerEl = document.querySelector(
      'header, sticky-header, .site-header, #shopify-section-header'
    );
    closeNativeHeaderSearch();

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
    productsGrid.setAttribute('aria-busy', String(isLoading));
    collectionsList?.setAttribute('aria-busy', String(isLoading));
    
    loader.style.display = "none"; // Hide old spinner entirely
    if (isLoading) {
      body.classList.add("cfp-has-results"); // Keep body visible for skeletons
      if (window.cfpSearchSettings?.instantLayout === 'compact') {
        productsGrid.innerHTML = Array.from({length:CONFIG.productLimit},()=>`<div class="cfp-compact-loading-card" aria-hidden="true"><span class="cfp-compact-loading-image cfp-compact-loading-fill"></span><span class="cfp-compact-loading-copy"><span class="cfp-compact-loading-line cfp-compact-loading-fill"></span><span class="cfp-compact-loading-line cfp-compact-loading-fill"></span><span class="cfp-compact-loading-price cfp-compact-loading-fill"></span></span></div>`).join('');
        if (collectionsList) collectionsList.innerHTML = Array.from({length:Math.min(3,CONFIG.collectionLimit??5)},()=>'<li class="cfp-compact-loading-chip cfp-compact-loading-fill" aria-hidden="true"></li>').join('');
        return;
      }
      
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

  async function fetchDefaultView(configurationReady = false) {
    resetFullNavigation();
    window.cfpActiveInstantSearchId = null;
    mainInput._cfpQueryActive = false;
    document.getElementById("cfp-search-body").classList.add("cfp-has-results");
    const viewAll = document.getElementById('cfp-view-all-results');
    if (viewAll) viewAll.hidden = true;
    if (!configurationReady) await refreshSearchConfiguration();
    renderLoading(true);

    try {
      let countryParam = "";
      if (window.Shopify && window.Shopify.country) {
         countryParam = `&country=${window.Shopify.country}`;
      }
      countryParam += `&locale=${encodeURIComponent(window.Shopify?.locale || '')}`;
      if (window.cfpCustomerTags) countryParam += `&customer_tags=${encodeURIComponent(window.cfpCustomerTags)}`;
      
      // 1. Fetch 4 popular products in background
      const productsPromise = CONFIG.showPopularProducts===false?Promise.resolve({products:[]}):fetchSearchJSON(
        `${CONFIG.apiUrl}?shop=${shopDomain}&limit=${CONFIG.popularProductLimit}&sortBy=best-selling${countryParam}`
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

      // 4. Update UI with fresh data if user hasn't typed anything yet
      const inputEl = document.getElementById("cfp-main-search-input");
      const currentQuery = inputEl ? inputEl.value : "";
      if (currentQuery.trim().length < CONFIG.minChars && !mainInput._cfpQueryActive) {
        renderPages({resources:{results:{pages:[]}}});
        renderRecentSearches("");
        renderCollections(collectionsData, "", true);
        await renderProducts(productsData, "", true, productsData ? productsData.contextualPricingApplied : false);
      }

    } catch (error) {
      console.error("Instant Search Default View Error:", error);
      if (!mainInput.value.trim()) {
        document.getElementById("cfp-search-products").innerHTML = 
          `<div class="cfp-search-no-results">Unable to load trending products.</div>`;
        if (document.getElementById("cfp-search-collections")) {
           document.getElementById("cfp-search-collections").innerHTML = "";
        }
      }
    } finally {
      if (mainInput.value.trim().length < CONFIG.minChars) renderLoading(false);
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

    if (CONFIG.manualSuggestions?.length) { if(isFullSearch()){if(container)container.style.display='none';renderPopularSearches();}else renderSuggestions(CONFIG.manualSuggestions, ''); return; }
    const searches = readRecentSearches();
    if (searches.length === 0) {
      if (container) container.style.display = "none";
      if (collectionsTitle) collectionsTitle.style.display = "block";
      return;
    }

    if (container) container.style.display = "block";
    if (collectionsTitle) collectionsTitle.style.display = isFullSearch() ? 'block' : 'none';

    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
        <div class="cfp-search-section-title" style="margin-bottom: 0;">Recent Searches</div>
      </div>
    `;
    searches.forEach((s) => {
      html += `
        <li class="cfp-recent-search-item">
          <a href="${window.cfpSearchResultUrl?.(s)||'/search?q='+encodeURIComponent(s)}" class="cfp-recent-search-link">
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
    suggestions = (Array.isArray(suggestions) ? suggestions : []).map(cleanSuggestionText).filter(Boolean).slice(0, query ? (CONFIG.suggestionLimit ?? 6) : 10);
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
        <div class="cfp-search-section-title" style="margin-bottom: 0;">${window.cfpSearchSettings?.instantLayout === 'compact' ? (query ? 'Popular' : 'Hot Searches') : 'Suggestions'}</div>
      </div>
    `;
    suggestions.forEach((s) => {
      // Highlight matching query
      const displayTitle = highlightSearchText(s, query);
      
      html += `
        <li class="cfp-recent-search-item">
          <a href="${window.cfpSearchResultUrl?.(s)||'/search?q='+encodeURIComponent(s)}" class="cfp-recent-search-link">
            <svg class="cfp-history-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <span class="cfp-suggestion-text">${displayTitle}</span>
          </a>
        </li>
      `;
    });
    if(list) list.innerHTML = html;
  }

  // Full screen navigation is optional and never blocks the product response.
  let fullNavigation={query:'',total:0,collections:[],active:''},fullNavigationTimer,fullSearchVersion=0;
  let fullPopularPromise;
  const fullNavigationCache=new Map();
  function isFullSearch(){return window.cfpSearchSettings?.instantLayout!=='compact';}
  function resetFullNavigation(){
    clearTimeout(fullNavigationTimer);fullSearchVersion++;
    fullNavigation={query:'',total:0,collections:[],active:''};
    const tabs=document.getElementById('cfp-full-category-tabs');if(tabs){tabs.hidden=true;tabs.innerHTML='';}
    const heading=document.getElementById('cfp-full-results-heading');if(heading)heading.textContent='Products';
    const popular=document.getElementById('cfp-full-popular');if(popular&&!isFullSearch())popular.hidden=true;
  }
  function fullSearchParameters(query){
    const params=new URLSearchParams({shop:shopDomain,isSearch:'true',searchType:'instant',q:query,suggestionLimit:'0',locale:window.Shopify?.locale||''});
    if(window.Shopify?.country)params.set('country',window.Shopify.country);
    if(window.cfpCustomerTags)params.set('customer_tags',window.cfpCustomerTags);
    return params;
  }
  function renderFullCategoryTabs(){
    const tabs=document.getElementById('cfp-full-category-tabs');if(!tabs)return;
    const state=fullNavigation;
    tabs.hidden=!isFullSearch()||!state.query||!state.collections.length;
    if(tabs.hidden){tabs.innerHTML='';return;}
    const entries=[{handle:'',title:'All results',count:state.total},...state.collections];
    tabs.innerHTML=entries.map(entry=>`<button type="button" role="tab" aria-controls="cfp-search-products" aria-selected="${entry.handle===state.active}" tabindex="${entry.handle===state.active?0:-1}">${instantEscapeHtml(entry.title)} <span>(${entry.count.toLocaleString()})</span></button>`).join('');
    tabs.querySelectorAll('button').forEach((button,index)=>{
      const select=next=>{performSearch(state.query,entries[next].handle);};
      button.addEventListener('click',()=>select(index));
      button.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?entries.length-1:(index+(event.key==='ArrowRight'?1:-1)+entries.length)%entries.length;
        select(next);tabs.querySelectorAll('button')[next]?.focus();
      });
    });
  }
  function scheduleFullCategories(query,total){
    if(!isFullSearch())return;
    fullNavigation.total=total;
    clearTimeout(fullNavigationTimer);
    const params=fullSearchParameters(query),key=params.toString();
    const current=()=>isFullSearch()&&mainInput.value.trim()===query&&fullNavigation.query===query;
    const cached=fullNavigationCache.get(key);
    if(cached&&Date.now()-cached.at<30000){fullNavigation.total=cached.total;fullNavigation.collections=cached.collections;renderFullCategoryTabs();return;}
    fullNavigationTimer=setTimeout(async()=>{
      try{
        params.set('categoryTabs','1');
        const data=await fetchSearchJSON(`${CONFIG.apiUrl}?${params}`);
        if(!current())return;
        const allParams=fullSearchParameters(query);allParams.set('categoryCount','1');allParams.set('limit','1');
        const [all,collections]=await Promise.all([fetchSearchJSON(`${CONFIG.apiUrl}?${allParams}`),Promise.all((data.collections||[]).slice(0,4).map(async collection=>{
          if(!/^[a-z0-9][a-z0-9-]*$/i.test(collection.handle||''))return null;
          const scoped=fullSearchParameters(query);scoped.set('collection',collection.handle);scoped.set('limit','1');scoped.set('categoryCount','1');
          try{const result=await fetchSearchJSON(`${CONFIG.apiUrl}?${scoped}`);return Number.isSafeInteger(result.matchCount)&&result.matchCount>0?{...collection,count:result.matchCount}:null;}catch{return null;}
        }))]);
        if(!current())return;
        if(!Number.isSafeInteger(all.matchCount)||all.matchCount<0)return;
        fullNavigation.total=all.matchCount;
        const valid=collections.filter(Boolean);fullNavigationCache.set(key,{at:Date.now(),total:all.matchCount,collections:valid});
        if(fullNavigationCache.size>20)fullNavigationCache.delete(fullNavigationCache.keys().next().value);
        fullNavigation.collections=valid;renderFullCategoryTabs();
      }catch{/* Optional navigation must leave successful products usable. */}
    },700);
  }
  function renderPopularSearches(){
    const section=document.getElementById('cfp-full-popular'),chips=document.getElementById('cfp-full-popular-chips');
    if(!section||!chips||!isFullSearch()){if(section)section.hidden=true;return;}
    const render=values=>{
      if(!isFullSearch())return;
      const terms=[...new Set(values.map(cleanSuggestionText).filter(Boolean))].slice(0,10);
      section.hidden=!terms.length;
      chips.innerHTML=terms.map(term=>`<button type="button">${instantEscapeHtml(term)}</button>`).join('');
      chips.querySelectorAll('button').forEach((button,index)=>button.addEventListener('click',()=>{mainInput.value=terms[index];mainInput.dispatchEvent(new Event('input',{bubbles:true}));mainInput.focus();}));
    };
    if(CONFIG.manualSuggestions?.length){render(CONFIG.manualSuggestions);return;}
    fullPopularPromise??=fetchSearchJSON(`${CONFIG.apiUrl.replace(/\/search(?:\?.*)?$/,'/search-navigation')}?shop=${encodeURIComponent(shopDomain)}`).catch(()=>({popularSearches:[]}));
    fullPopularPromise.then(data=>{if(!CONFIG.manualSuggestions?.length)render(data.popularSearches||[]);});
  }
  async function performSearch(query, collectionHandle='') {
    const trimmedQuery = query.trim().toLowerCase();
    if (query.trim().length < CONFIG.minChars) return;
    const version=++fullSearchVersion;
    if(isFullSearch()){
      if(fullNavigation.query!==query){clearTimeout(fullNavigationTimer);fullNavigation={query,total:0,collections:[],active:''};}
      fullNavigation.active=collectionHandle;renderFullCategoryTabs();
      const heading=document.getElementById('cfp-full-results-heading');if(heading)heading.textContent=`Search results for “${query}”`;
    }
    
    await refreshSearchConfiguration();
    if(CONFIG.enabled===false){closeModal();return;}
    if (mainInput.value.trim() !== query || version!==fullSearchVersion) return;
    if (query.length < CONFIG.minChars) {
      window.cfpActiveInstantSearchId = null;
      document.getElementById('cfp-search-body').classList.remove('cfp-has-results');
      const viewAll = document.getElementById('cfp-view-all-results');
      if (viewAll) viewAll.hidden = true;
      return;
    }
    mainInput._cfpQueryActive = true;
    document.getElementById('cfp-search-body').classList.add('cfp-has-results');
    renderRecentSearches(query);
    renderLoading(true);
    const currentViewAll = document.getElementById('cfp-view-all-results');
    if (currentViewAll) currentViewAll.hidden = true;

    try {
      let countryParam = "";
      if (window.Shopify && window.Shopify.country) {
         countryParam = `&country=${window.Shopify.country}`;
      }

      // 1. Fetch products from OUR API in background
      countryParam += `&locale=${encodeURIComponent(window.Shopify?.locale || '')}`;
      if (window.cfpCustomerTags) countryParam += `&customer_tags=${encodeURIComponent(window.cfpCustomerTags)}`;
      const productsPromise = fetchSearchJSON(
        `${CONFIG.apiUrl}?shop=${shopDomain}&isSearch=true&searchType=instant&q=${encodeURIComponent(query)}&limit=${CONFIG.productLimit}&suggestionLimit=${CONFIG.suggestionLimit ?? 6}${countryParam}${isFullSearch()&&collectionHandle?'&collection='+encodeURIComponent(collectionHandle):''}`
      );

      // 2. Fetch collections from Shopify Predictive Search API in background
      const rootUrl = window.Shopify && window.Shopify.routes ? window.Shopify.routes.root : "/";
      const collectionsPromise = CONFIG.collectionLimit === 0 ? Promise.resolve({resources:{results:{collections:[]}}}) : fetchSearchJSON(
        `${rootUrl}search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=collection&resources[limit]=${CONFIG.collectionLimit ?? 5}`
      ).catch(() => ({resources:{results:{collections:[]}}}));

      const pagesPromise=CONFIG.showPages&&CONFIG.pageLimit>0?fetchSearchJSON(`${rootUrl}search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=page&resources[limit]=${CONFIG.pageLimit}`).catch(()=>({resources:{results:{pages:[]}}})):Promise.resolve({resources:{results:{pages:[]}}});
      const productsData = await productsPromise;

      // 4. Update UI with fresh data if user hasn't changed query
      const inputEl = document.getElementById("cfp-main-search-input");
      const currentQuery = inputEl ? inputEl.value.trim().toLowerCase() : "";
      if (currentQuery === trimmedQuery && version===fullSearchVersion) {
        const searchId = window.CfpAnalytics?.newSearchId?.();
        if (searchId) {
          window.CfpAnalytics?.track('autocomplete_impression', { search_id: searchId });
        }
        window.cfpActiveInstantSearchId = searchId || null;
        window.cfpActiveInstantSearchQuery = searchId ? query : null;
        window.cfpActiveInstantSearchHits = Number.isSafeInteger(productsData?.matchCount) ? productsData.matchCount :
          (Number(productsData?.totalCount) || productsData?.products?.length || 0);
        
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

        if (productsData && productsData.suggestions && productsData.suggestions.length > 0) {
           renderSuggestions(productsData.suggestions, query);
        } else if (currentQuery.length > 0) {
           // Hide suggestions container if no suggestions
           const container = document.getElementById("cfp-recent-searches-container");
           if (container) container.style.display = "none";
        }
        await renderProducts(productsData, query, false, productsData ? productsData.contextualPricingApplied : false);
        if(version!==fullSearchVersion||mainInput.value.trim().toLowerCase()!==trimmedQuery)return;
        renderLoading(false);
        if(isFullSearch()&&!collectionHandle)scheduleFullCategories(query,Number.isSafeInteger(productsData.matchCount)?productsData.matchCount:0);
        const viewAll = document.getElementById('cfp-view-all-results');
        if (viewAll) {
          const count = Number.isSafeInteger(productsData?.matchCount) ? productsData.matchCount : productsData?.totalCount;
          viewAll.hidden = !productsData?.products?.length;
          if (!viewAll.hidden) {
            viewAll.href = window.cfpSearchResultUrl?.(query) || `/search?q=${encodeURIComponent(query)}`;
            if(isFullSearch()&&collectionHandle){const url=new URL(viewAll.href,location.origin);const collection=fullNavigation.collections.find(item=>item.handle===collectionHandle);if(collection)url.searchParams.set('collections',collection.title);viewAll.href=url.href;}
            viewAll.textContent = Number.isSafeInteger(count) && count >= productsData.products.length
              ? `View all ${count.toLocaleString()} results` : 'View all results';
          }
        }
      }
      const [collectionsData,pagesData] = await Promise.all([collectionsPromise,pagesPromise]);
      if (mainInput.value.trim().toLowerCase() === trimmedQuery && version===fullSearchVersion) {
        renderCollections(collectionsData, query);
        renderPages(pagesData,query);
      }

    } catch (error) {
      console.error("Instant Search Error:", error);
      if (mainInput.value.trim().toLowerCase() === trimmedQuery && version===fullSearchVersion) {
        const viewAll = document.getElementById('cfp-view-all-results');
        if (viewAll) viewAll.hidden = true;
        renderSearchError();
      }
    } finally {
      if (mainInput.value.trim().toLowerCase() === trimmedQuery && version===fullSearchVersion) renderLoading(false);
    }
  }

  function renderSearchError() {
    const grid = document.getElementById('cfp-search-products');
    grid.innerHTML = `<div class="cfp-search-error" role="status">
      <span class="cfp-search-error__icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4M10.5 7.5v3m0 3h.01"/></svg></span>
      <strong>We couldn't load your search</strong>
      <p>Please try again in a moment.</p>
      <button type="button" id="cfp-search-retry">Try again</button>
    </div>`;
    for (const id of ['cfp-search-collections','cfp-search-pages']) {
      const element = document.getElementById(id);
      if (element) element.innerHTML = '';
    }
    for (const id of ['cfp-collections-title','cfp-pages-title','cfp-did-you-mean-container']) {
      const element = document.getElementById(id);
      if (element) element.style.display = 'none';
    }
    const productsTitle = document.getElementById('cfp-compact-products-title');
    if (productsTitle) productsTitle.hidden = true;
    document.getElementById('cfp-search-retry').addEventListener('click', event => {
      const query = mainInput.value.trim();
      if (query.length < CONFIG.minChars) return;
      event.currentTarget.disabled = true;
      performSearch(query);
    });
  }

  function renderPages(data,query=''){
    const container=document.getElementById('cfp-search-pages'),title=document.getElementById('cfp-pages-title');if(!container||!title)return;
    const pages=CONFIG.showPages?(data?.resources?.results?.pages||[]).slice(0,CONFIG.pageLimit):[];
    const links=pages.flatMap(page=>{try{const url=new URL(page.url,location.origin);if(url.origin!==location.origin||!url.pathname.includes('/pages/'))return [];return `<li><a href="${instantEscapeHtml(url.pathname+url.search)}">${highlightSearchText(page.title||'',query)}</a></li>`;}catch{return [];}});
    container.innerHTML=links.join('');container.style.display=links.length?'':'none';title.style.display=links.length?'':'none';
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

    if (window.cfpSearchSettings?.instantLayout === 'compact' && query?.trim()) {
      const root = window.Shopify?.routes?.root || '/';
      const links = collections.slice(0, CONFIG.collectionLimit ?? 5).flatMap(collection => {
        try {
          const url = new URL(collection.url || root + 'collections/' + encodeURIComponent(collection.handle), location.origin);
          if (url.origin !== location.origin || !url.pathname.includes('/collections/')) return [];
          return `<li><a href="${instantEscapeHtml(url.pathname + url.search)}">${highlightSearchText(collection.title, query)}</a></li>`;
        } catch { return []; }
      });
      if (titleElement) { titleElement.textContent = 'Categories'; titleElement.style.display = links.length ? 'block' : 'none'; }
      list.innerHTML = links.join('');
      return;
    }
    if (titleElement && (window.cfpSearchSettings?.instantLayout === 'compact' || titleElement.textContent === 'Categories')) titleElement.textContent = 'Collections';

    const root=window.Shopify?.routes?.root||'/',missing=[];
    list.innerHTML=collections.slice(0,CONFIG.collectionLimit??5).flatMap(collection=>{
      try{
        const url=new URL(collection.url||root+'collections/'+encodeURIComponent(collection.handle),location.origin);
        if(url.origin!==location.origin||!url.pathname.includes('/collections/'))return [];
        const handle=decodeURIComponent(url.pathname.split('/collections/')[1].split('/')[0]);
        const image=collectionThumbnail(collection.featured_image||collection.image||collection.images?.[0]);
        if(!image)missing.push(handle);
        return `<li><a class="cfp-full-collection-link" data-handle="${instantEscapeHtml(handle)}" href="${instantEscapeHtml(url.pathname+url.search)}"><span class="cfp-full-collection-image">${image?`<img src="${instantEscapeHtml(image)}" alt="" width="48" height="58" loading="lazy">`:''}</span><span>${highlightSearchText(collection.title,query)}</span><span class="cfp-full-collection-arrow" aria-hidden="true">›</span></a></li>`;
      }catch{return [];}
    }).join('');
    if(titleElement){titleElement.textContent='Collections';titleElement.style.display=list.children.length?'block':'none';}
    const links=[...list.querySelectorAll('.cfp-full-collection-link')];
    links.forEach(link=>link.querySelector('img')?.addEventListener('error',event=>event.currentTarget.remove(),{once:true}));
    if(isFullSearch()&&missing.length){
      const endpoint=CONFIG.apiUrl.replace(/\/search(?:\?.*)?$/,'/search-navigation');
      fetchSearchJSON(`${endpoint}?shop=${encodeURIComponent(shopDomain)}&handles=${encodeURIComponent(missing.slice(0,8).join(','))}`).then(data=>{
        if(!isFullSearch())return;
        for(const collection of data.collections||[]){
          const image=collectionThumbnail(collection.image);if(!image)continue;
          const link=links.find(link=>link.dataset.handle===collection.handle);
          if(!link?.isConnected||link.querySelector('img'))continue;
          const img=document.createElement('img');img.src=image;img.alt='';img.width=48;img.height=58;img.loading='lazy';img.addEventListener('error',()=>img.remove(),{once:true});link.querySelector('.cfp-full-collection-image').appendChild(img);
        }
      }).catch(()=>{});
    }
  }

  function collectionThumbnail(value){
    const candidate=typeof value==='string'?value:value?.url||value?.src||'';
    if(!candidate.trim())return '';
    try{const url=new URL(candidate,location.origin);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}
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
      if (query && window.cfpSearchSettings?.instantLayout === 'compact') {
        grid.innerHTML = `<div class="cfp-search-no-results cfp-search-no-results--compact" role="status">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
          <strong>No products found for “${instantEscapeHtml(query)}”</strong>
          <p>Check the spelling or try a different keyword.</p>
          <button type="button" id="cfp-search-clear-empty">Clear search</button>
        </div>`;
        const heading = document.getElementById('cfp-compact-products-title');
        if (heading) heading.hidden = true;
        document.getElementById('cfp-search-clear-empty').addEventListener('click', () => {
          mainInput.value = '';
          mainInput.dispatchEvent(new Event('input', { bubbles: true }));
          mainInput.focus();
        });
        return;
      }
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
       const settings=window.cfpSearchSettings||{};if(settings.imageSizeType==='original')return raw;
       try{
         const url=new URL(raw,location.href);
         if(url.hostname==='cdn.shopify.com'||url.pathname.startsWith('/cdn/shop/')){
           url.searchParams.set('width',String(settings.imageSizeType==='fixed'?settings.fixedImageWidth||600:parseInt(size,10)||600));return url.href;
         }
       }catch{}
       return raw;
    };

    products.forEach((p, productIndex) => {
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

      let price = "";
      if (p.priceMin !== undefined) {
         price = window.cfpFormatMoney?.(p.priceMin) || new Intl.NumberFormat('en-US', {style:'currency',currency:window.Shopify?.currency?.active || 'USD'}).format(p.priceMin);
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
        <div class="cfp-product-card cfp-search-result-card"${window.cfpSearchSettings?.instantLayout==='compact'?` title="${instantEscapeHtml(p.title)}"`:''} data-cfp-product-id="${instantEscapeHtml(p.id)}" data-cfp-position="${productIndex + 1}" style="position:relative; width: 100%;">
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
            <div class="cfp-search-product-title" style="margin-top: 12px; font-size: 14px; font-weight: 500; text-align: center;">${window.cfpSearchSettings?.instantLayout === 'compact' && query ? highlightSearchText(p.title, query) : instantEscapeHtml(p.title)}</div>
            ${swatchesHtml}
            ${(data.globalSettings && data.globalSettings.isWholesale && !window.cfpCustomerLoggedIn) ? '' : `
            <div class="cfp-search-product-price" style="margin-top: 8px; text-align: center;">${p._marketPricingUnavailable ? "See product price" : instantEscapeHtml(price)}</div>
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
      const text=window.cfpFormatMoney?.(variant?.price ?? product.priceMin) || new Intl.NumberFormat('en-US', {style:'currency',currency:window.Shopify?.currency?.active || 'USD'}).format(variant?.price ?? product.priceMin);
      price.textContent=window.cfpSearchPriceUnit?.(text)||text;
    }).catch(() => {});
  }
});




