// Authenticate embedded admin data requests independently of third-party cookies.
export function installAdminFetch(browser) {
  const original = browser.fetch.bind(browser);
  browser.fetch = async (input, init) => {
    const request = new Request(input instanceof Request ? input : new URL(input, browser.location.href), init);
    const url = new URL(request.url);
    const internal = url.origin === browser.location.origin &&
      (url.pathname === '/app' || url.pathname.startsWith('/app/') || url.pathname === '/app.data' || url.pathname === '/api/import-pins-batch');
    if (!internal || request.headers.has('Authorization')) return original(input, init);
    // App Bridge owns token issuance and refresh; never store tokens ourselves.
    let bridge = browser.shopify;
    for (let attempt = 0; !bridge?.idToken && attempt < 50; attempt++) {
      await new Promise(resolve => browser.setTimeout(resolve, 100));
      bridge = browser.shopify;
    }
    if (!bridge?.idToken) throw new Error('Shopify authentication is still loading. Reopen the app from Shopify Admin.');
    const token = await bridge.idToken();
    const headers = new Headers(request.headers);
    headers.set('Authorization', 'Bearer ' + token);
    return original(new Request(request, { headers }));
  };
}
