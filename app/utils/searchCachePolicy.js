// The public search API derives shopper-visible content only from URL inputs.
// Customer-tag rules and authorized requests must never enter a shared cache.
export function searchCacheHeaders(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('Authorization') ||
      String(url.searchParams.get('customer_tags') || '').trim()) {
    return { 'Cache-Control': 'private, no-store' };
  }
  // Browsers revalidate on reload. A configured reverse proxy/CDN may reuse
  // the exact URL for up to one minute; the URL includes shop, country and
  // locale. No stale extension is offered beyond that minute.
  return {
    'Cache-Control': 'public, max-age=0, s-maxage=60',
    'CDN-Cache-Control': 'public, max-age=60',
  };
}
