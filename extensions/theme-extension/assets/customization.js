/* Optional theme customization. Never awaited by search or product rendering. */
(function () {
  if (window.cfpCustomizationReady) return;
  window.cfpCustomizationReady = (async function () {
    const context = window.cfpCustomizationContext && { ...window.cfpCustomizationContext, themeId: String(window.cfpCustomizationContext.themeId || window.Shopify?.theme?.id || '') };
    if (new URLSearchParams(location.search).get('cfp_disable_customization') === '1') return null;
    if (!context || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(context.shop) || !/^[1-9]\d{0,19}$/.test(context.themeId)) return null;
    const endpoint = new URL('https://aisearchfilter.webvory.com/api/customization');
    endpoint.search = new URLSearchParams({ shop: context.shop, themeId: context.themeId }).toString();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1500);
    let config;
    try {
      const response = await fetch(endpoint.href, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) return null;
      config = (await response.json()).customization;
    } catch { return null; }
    finally { clearTimeout(timer); }
    if (!config || typeof config.css !== 'string' || config.css.length > 100000 || !Array.isArray(config.swatches) || config.swatches.length > 200 || typeof config.javascriptEnabled !== 'boolean') return null;
    const normalize = value => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    const swatches = new Map();
    for (const swatch of config.swatches) {
      if (!swatch || typeof swatch.color !== 'string' || swatch.color.length > 100 || !/^#[\da-f]{6}$/i.test(swatch.hex)) return null;
      swatches.set(normalize(swatch.color), swatch.hex);
    }
    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (config.css.trim()) {
      const style = document.createElement('style');
      style.id = 'cfp-theme-custom-css'; style.textContent = config.css; document.head.appendChild(style);
    }
    if (swatches.size) {
      const apply = root => {
        const labels = [];
        if (root.matches?.('#cfp-sidebar .cfp-color-swatch')) labels.push(root);
        root.querySelectorAll?.('#cfp-sidebar .cfp-color-swatch').forEach(label => labels.push(label));
        for (const label of labels) {
          const color = label.querySelector('input')?.value, visual = label.querySelector('.cfp-swatch-circle');
          const hex = typeof color === 'string' ? swatches.get(normalize(color)) : null;
          if (hex && visual) { visual.style.setProperty('background', hex, 'important'); }
        }
      };
      apply(document);
      const observer = new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) apply(node); });
      observer.observe(document.body, { childList: true, subtree: true });
      // Remove work when a page leaves; BFCache restores the same DOM and colors.
      addEventListener('pagehide', () => observer.disconnect());
      addEventListener('pageshow', event => { if (event.persisted) observer.observe(document.body, { childList: true, subtree: true }); });
    }
    window.cfpCustomization = { themeId: context.themeId, swatches: config.swatches };
    const ready = () => document.dispatchEvent(new CustomEvent('cfp:customization-ready', { detail: { themeId: context.themeId } }));
    if (config.javascriptEnabled) {
      const script = document.createElement('script');
      script.id = 'cfp-theme-custom-js'; script.async = true;
      endpoint.searchParams.set('asset', 'javascript'); script.src = endpoint.href;
      script.addEventListener('load', ready, { once: true });
      script.addEventListener('error', ready, { once: true });
      document.head.appendChild(script);
    } else ready();
    return window.cfpCustomization;
  })().catch(() => null);
})();
