/* Optional settings: unavailable APIs preserve theme defaults. */
(function () {
  if (window.cfpSearchSettingsReady) return;
  window.cfpSearchSettingsReady = (async function () {
    if (!window.Shopify?.shop) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch('https://aisearchfilter.webvory.com/api/search-settings?shop=' + encodeURIComponent(window.Shopify.shop), { signal: controller.signal });
      if (!response.ok) return null;
      const { settings } = await response.json();
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
      window.cfpSearchSettings = settings;
      return settings;
    } catch { return null; }
    finally { clearTimeout(timer); }
  })();
})();
