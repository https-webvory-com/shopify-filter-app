// Small automatic entry point. The full widget is needed only with an app block.
(function () {
  if (window._cfpWidgetEntryLoaded || window._cfpRendererLoaded) return;
  const script = document.currentScript;
  if (!script?.src) return;
  const runtimeUrl = script.dataset.cfpRuntime || new URL('collectionFilterPro.min.js', script.src).href;
  window._cfpWidgetEntryLoaded = true;
  let observer;
  function start() {
    if (!document.querySelector('.cfp-v1-app-container #cfp-sidebar')) return false;
    observer?.disconnect();
    if (window._cfpRendererLoaded || document.querySelector('script[data-cfp-widget-runtime]')) return true;
    const runtime = document.createElement('script');
    runtime.src = runtimeUrl;
    runtime.async = true;
    runtime.dataset.cfpWidgetRuntime = '';
    runtime.onerror = function () {
      // Allow a later block/entry invocation to retry a failed CDN request.
      window._cfpWidgetEntryLoaded = false;
      runtime.remove();
    };
    document.head.append(runtime);
    return true;
  }
  if (start()) return;
  if (document.readyState !== 'loading') {
    window._cfpWidgetEntryLoaded = false;
    return;
  }
  observer = new MutationObserver(start);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function () {
    start();
    observer.disconnect();
    if (!document.querySelector('.cfp-v1-app-container #cfp-sidebar')) window._cfpWidgetEntryLoaded = false;
  }, { once: true });
})();
