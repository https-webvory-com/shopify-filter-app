/* Optional settings: unavailable APIs preserve theme defaults. */
(function () {
  window.cfpSearchResultUrl=function(query){
    const path=window.cfpSearchSettings?.searchResultsPath||'/search',root=window.Shopify?.routes?.root||'/';
    const safe=/^\/(?!\/)[a-z0-9/_-]+$/i.test(path)?path:'/search';
    return (root==='/'?safe:root.replace(/\/$/,'')+safe)+'?q='+encodeURIComponent(query||'');
  };
  window.cfpSearchPriceUnit=function(value){const unit=window.cfpSearchSettings?.priceUnit;return unit?String(value)+' '+String(unit):String(value);};
  if (window.cfpSearchSettingsReady) return;
  let pending;
  window.cfpRefreshSearchSettings = function () {
    if (pending) return pending;
    pending = load().finally(() => { pending = null; });
    return pending;
  };
  async function load() {
    if (!window.Shopify?.shop) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch('https://aisearchfilter.webvory.com/api/search-settings?shop=' + encodeURIComponent(window.Shopify.shop), { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) return null;
      const { settings } = await response.json();
      if (settings === null) { window.cfpSearchSettings = null; notify(); return null; }
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
      window.cfpSearchSettings = settings;
      notify();
      return settings;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }
  function notify() {
    if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') document.dispatchEvent(new CustomEvent('cfp:search-settings-ready'));
  }
  window.cfpSearchSettingsReady = window.cfpRefreshSearchSettings();
})();
