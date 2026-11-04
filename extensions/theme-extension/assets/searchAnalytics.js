// Anonymous, consent-gated storefront events. No customer or cart identity is
// read; the only persistent identifier is an analytics cookie after permission.
if (!window.CfpAnalytics) {
  const queue = [];
  const id = prefix => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return `${prefix}_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  };
  const shop = window.Shopify?.shop;
  const api = new URL('/api/v2/events', window.API_DOMAIN || 'https://aisearchfilter.webvory.com');
  if (shop) api.searchParams.set('shop', shop);
  let allowed = false;
  let anonId = null;
  let sessionId = null;
  let inFlight = false;
  const cookieName = 'cfp_analytics_id';
  const readCookie = () => document.cookie.split('; ').find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const updatePermission = () => {
    allowed = window.Shopify?.customerPrivacy?.analyticsProcessingAllowed?.() === true;
    if (!allowed) { queue.length = 0; anonId = null; sessionId = null; return; }
    anonId = readCookie();
    if (!/^anon_[a-f0-9]{32}$/.test(anonId || '')) {
      anonId = id('anon');
      document.cookie = `${cookieName}=${anonId}; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
    }
    try {
      sessionId = sessionStorage.getItem('cfp_analytics_session');
      if (!/^session_[a-f0-9]{32}$/.test(sessionId || '')) {
        sessionId = id('session');
        sessionStorage.setItem('cfp_analytics_session', sessionId);
      }
    } catch { sessionId = id('session'); }
  };
  const flush = async (unloading = false) => {
    if (!allowed || !shop || !queue.length || inFlight) return;
    inFlight = true;
    const batch = queue.splice(0, 25);
    const body = JSON.stringify(batch);
    try {
      if (unloading && navigator.sendBeacon?.(api.href, new Blob([body], { type: 'text/plain' }))) return;
      const response = await fetch(api.href, { method: 'POST', body, keepalive: true,
        headers: { 'Content-Type': 'text/plain' } });
      if (!response.ok) throw Error('Analytics transport unavailable');
    } catch {
      if (allowed) queue.unshift(...batch);
    } finally {
      inFlight = false;
      if (queue.length >= 25) setTimeout(() => flush(), 0);
    }
  };
  window.CfpAnalytics = {
    newSearchId: () => id('search'),
    newListingId: () => id('listing'),
    track(event, attributes = {}) {
      if (!allowed || !shop) return false;
      queue.push({ event_id: id('event'), event, shop, ts: new Date().toISOString(),
        anon_id: anonId, session_id: sessionId, market: window.Shopify?.country || null,
        locale: window.Shopify?.locale || null, ...attributes });
      if (queue.length >= 25) flush();
      return true;
    },
    flush,
  };
  document.addEventListener('visitorConsentCollected', updatePermission);
  window.addEventListener('pagehide', () => { void flush(true); });
  setInterval(flush, 5000);
  if (window.Shopify?.customerPrivacy) updatePermission();
  else window.Shopify?.loadFeatures?.([{ name: 'consent-tracking-api', version: '0.2' }], error => {
    if (!error) updatePermission();
  });
}
