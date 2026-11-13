// Explicit pins can come from outside the Meilisearch result set. Apply the
// same shopper filters to their saved variants before inserting them.
export function pinnedProductMatchesAppliedIntent(product, parsedQuery) {
  const applied = parsedQuery?.appliedIntent;
  if (!applied?.price && !applied?.size) return true;
  let options = product.options || [];
  if (typeof options === 'string') {
    try { options = JSON.parse(options); } catch { options = []; }
  }
  const sizePosition = options.findIndex(option => /^size$/i.test(option.name || ''));
  const requestedSize = parsedQuery.intent?.size;
  const constraint = parsedQuery.intent?.price;
  return product.variants?.some(variant => {
    if (applied.price && variant.available === false) return false;
    if (applied.size && (sizePosition < 0 ||
      String(variant[`option${sizePosition + 1}`] || '').toUpperCase() !== requestedSize)) return false;
    if (!applied.price) return true;
    const raw = variant.marketPrices?.[applied.country]?.price;
    const price = raw == null ? NaN : Number(raw);
    return Number.isFinite(price) && price >= 0 && constraint &&
      (constraint.min == null || price >= constraint.min) &&
      (constraint.max == null || (constraint.maxExclusive ? price < constraint.max : price <= constraint.max));
  }) || false;
}
