(() => {
  if (!/\/search\/?$/i.test(location.pathname) || window.cfpSearchBannersStarted) return;
  window.cfpSearchBannersStarted = true;
  const shop = window.Shopify?.shop;
  if (!shop) return;
  let banners = [], observer, timer;
  const failedImages = new Set();
  const nativeOffsets = new Map();
  const safeUrl = (value, image = false) => {
    if (!value || typeof value !== 'string' || /[\\\u0000-\u0020\u007f]/u.test(value) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return '';
    if (!/^https:\/\//i.test(value) && (image || !value.startsWith('/') || value.startsWith('//'))) return '';
    try { const url = new URL(value, location.origin); return (value.startsWith('/') || url.protocol === 'https:') && !url.username && !url.password ? value : ''; } catch { return ''; }
  };
  const node = (tag, className, text) => { const el = document.createElement(tag); el.className = className; if (text) el.textContent = text; return el; };
  function makeBanner(banner, grid) {
    const el = node(grid && /^(UL|OL)$/.test(grid.tagName) ? 'li' : 'div', `cfp-search-banner cfp-search-banner--${banner.placement}`);
    if (grid) el.classList.add('grid__item');
    el.dataset.cfpBanner = banner.id;
    for (const [property, value] of [['backgroundColor', banner.backgroundColor], ['color', banner.textColor]]) if (/^#[0-9a-f]{6}$/i.test(value)) el.style[property] = value;
    const target = safeUrl(banner.targetUrl), body = node(target ? 'a' : 'div', 'cfp-search-banner__link');
    if (target) { body.href = target; body.setAttribute('aria-label', banner.description || banner.heading || banner.buttonLabel || 'View promotion'); }
    const image = safeUrl(banner.imageUrl, true);
    if (image && !failedImages.has(banner.id)) {
      const img = document.createElement('img'); img.src = image; img.alt = banner.description || banner.heading || ''; img.loading = 'lazy';
      img.addEventListener('error', () => { failedImages.add(banner.id); img.remove(); if (!banner.heading && !banner.content && !banner.buttonLabel) el.remove(); }, { once: true });
      body.append(img);
    }
    if (banner.heading || banner.content || (target && banner.buttonLabel)) {
      const copy = node('div', 'cfp-search-banner__copy');
      if (banner.heading) copy.append(node('h3', '', banner.heading));
      if (banner.content) copy.append(node('p', '', banner.content));
      if (target && banner.buttonLabel) copy.append(node('span', 'cfp-search-banner__button', banner.buttonLabel));
      body.append(copy);
    }
    el.append(body); return el;
  }
  function watch() { observer?.observe(document.querySelector('main') || document.body, { childList: true, subtree: true }); }
  async function findNativeOffset(page) {
    if (nativeOffsets.has(page)) return;
    nativeOffsets.set(page, Infinity);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const url = new URL(location.href); url.searchParams.set('page', '1');
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return;
      // Parse inert HTML; never execute scripts from the theme response.
      const firstPage = new DOMParser().parseFromString(await response.text(), 'text/html');
      const firstGrid = firstPage.querySelector('main #product-grid');
      const size = firstGrid ? [...firstGrid.children].filter(el => el.querySelector('a[href*="/products/"]')).length : 0;
      if (size) { nativeOffsets.set(page, (page - 1) * size); schedule(); }
    } catch { /* Unknown offsets hide grid campaigns rather than repeat them. */ }
    finally { clearTimeout(timeout); }
  }
  function render() {
    observer?.disconnect();
    document.querySelectorAll('[data-cfp-banner]').forEach(el => el.remove());
    const grid = document.getElementById('cfp-products-container') || document.querySelector('main #product-grid');
    const anchor = grid || document.querySelector('main .template-search');
    if (anchor) {
      const products = grid ? [...grid.children].filter(el => !el.classList.contains('cfp-load-more-container') && (el.classList.contains('cfp-product-card') || el.querySelector('a[href*="/products/"]'))) : [];
      const page = Math.max(1, Number(new URLSearchParams(location.search).get('page')) || 1);
      if (grid?.id === 'product-grid' && grid.dataset.cfpSearchOffset === undefined && page > 1 && banners.some(b => b.placement === 'grid')) findNativeOffset(page);
      const offset = grid?.dataset.cfpSearchOffset !== undefined ? Number(grid.dataset.cfpSearchOffset) : page > 1 ? nativeOffsets.get(page) ?? Infinity : 0;
      for (const banner of banners) {
        if (failedImages.has(banner.id) && !banner.heading && !banner.content && !banner.buttonLabel) continue;
        if (banner.placement === 'top') anchor.before(makeBanner(banner));
        else if (banner.placement === 'grid' && Number.isInteger(banner.position) && banner.position > offset && banner.position <= offset + products.length) products[banner.position - offset - 1].before(makeBanner(banner, grid));
      }
    }
    watch();
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(render, 50); }
  async function start() {
    try { if (window.cfpSearchRedirectPromise && await window.cfpSearchRedirectPromise) return; } catch { /* Ordinary search may continue. */ }
    const query = new URLSearchParams(location.search).get('q');
    if (!query?.trim()) return;
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const response = await fetch(`https://aisearchfilter.webvory.com/api/search-banners?${new URLSearchParams({ shop, q: query })}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) return;
      const result = await response.json();
      if (!Array.isArray(result.banners)) return;
      banners = result.banners.filter(b => b && typeof b.id === 'string' && ['top', 'grid'].includes(b.placement));
      if (!banners.length) return;
      observer = new MutationObserver(schedule); render();
      document.addEventListener('cfp:search-products-rendered', schedule);
    } catch { /* A promotion failure leaves ordinary search available. */ }
    finally { clearTimeout(timeout); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
})();
