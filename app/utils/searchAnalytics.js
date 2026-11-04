const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;
const ID = /^[a-zA-Z0-9_-]{8,128}$/;
const COUNTRY = /^[A-Z]{2}$/;
const EVENTS = new Set(['search_query', 'autocomplete_impression', 'suggestion_click',
  'zero_result', 'filter_apply', 'sort_change', 'result_impression', 'result_click',
  'quick_view', 'add_to_cart', 'experiment_exposure']);
const PRODUCT_EVENTS = new Set(['result_impression', 'result_click', 'quick_view', 'add_to_cart']);

const text = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const plainId = value => ID.test(value || '') ? value : null;
const productId = value => {
  const id = String(value || '').split('/').pop();
  return /^\d{1,20}$/.test(id) ? id : null;
};

// Only explicitly named fields leave the browser. Unknown keys, cookies, IPs,
// customer identifiers and arbitrary event properties never enter storage.
export function normalizeSearchEvent(input, { shop, now = new Date() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !SHOP.test(shop || '') || input.shop !== shop || !EVENTS.has(input.event) ||
      !plainId(input.event_id) || !plainId(input.anon_id)) {
    throw new Error('Invalid analytics event');
  }
  if (typeof input.ts !== 'string') throw new Error('Invalid analytics timestamp');
  const at = new Date(input.ts);
  if (!Number.isFinite(at.getTime()) || at.getTime() > now.getTime() + 300000 ||
      at.getTime() < now.getTime() - 86400000) throw new Error('Invalid analytics timestamp');
  const searchId = plainId(input.search_id), listingId = plainId(input.listing_id);
  if (!searchId && !listingId) throw new Error('Missing search or listing ID');
  if (input.event === 'search_query' && !searchId) throw new Error('Missing search ID');
  const market = String(input.market || '').toUpperCase();
  if (market && !COUNTRY.test(market)) throw new Error('Invalid market');
  const result = {
    eventId: input.event_id, event: input.event, shop, at,
    anonId: input.anon_id, sessionId: plainId(input.session_id),
    searchId, listingId, market: market || null,
    locale: text(input.locale, 20) || null,
    query: input.event === 'search_query' ? text(input.q, 200) : null,
    filterKey: input.event === 'filter_apply' ? text(input.filter_key, 80) || null : null,
    filterValue: input.event === 'filter_apply' ? text(input.filter_value, 120) || null : null,
    hits: input.event === 'search_query' && Number.isSafeInteger(input.hits) && input.hits >= 0
      ? Math.min(input.hits, 1000000) : null,
    position: Number.isSafeInteger(input.position) && input.position >= 1 && input.position <= 10000
      ? input.position : null,
    productId: PRODUCT_EVENTS.has(input.event) ? productId(input.product_id) : null,
    variantId: input.event === 'add_to_cart' ? productId(input.variant_id) : null,
    ruleId: plainId(input.rule_id), experimentId: plainId(input.experiment_id),
    experimentVariant: text(input.experiment_variant, 64) || null,
  };
  if (PRODUCT_EVENTS.has(result.event) && !result.productId) throw new Error('Missing product ID');
  if (result.event === 'add_to_cart' && !result.variantId) throw new Error('Missing variant ID');
  if (result.event === 'experiment_exposure' && (!result.experimentId || !result.experimentVariant))
    throw new Error('Invalid experiment exposure');
  return result;
}

export function normalizeSearchEventBatch(input, context) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 25)
    throw new Error('Invalid analytics batch');
  const events = input.map(event => normalizeSearchEvent(event, context));
  if (new Set(events.map(event => event.eventId)).size !== events.length)
    throw new Error('Duplicate analytics event ID');
  return events;
}
