const COUNTRY = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

export function marketCountries(values = []) {
  if (!Array.isArray(values)) throw Error('Invalid market countries');
  const countries = [...new Set(values.map(value => String(value).toUpperCase()))];
  if (countries.some(country => !COUNTRY.test(country))) throw Error('Invalid market country');
  return countries.sort();
}

export function contextualPricingFields(countries) {
  return marketCountries(countries).map(country =>
    `cfpMarket_${country}: contextualPricing(context: {country: ${country}}) { price { amount currencyCode } compareAtPrice { amount currencyCode } }`
  ).join('\n');
}

export function marketCountriesInVariants(variants = []) {
  return marketCountries(variants.flatMap(variant => Object.keys(variant || {})
    .filter(key => /^cfpMarket_[A-Z]{2}$/.test(key)).map(key => key.slice(10))));
}

export function variantMarketPrices(variant, countries) {
  const prices = {};
  for (const country of marketCountries(countries)) {
    const value = variant?.[`cfpMarket_${country}`];
    const price = value?.price?.amount == null ? NaN : Number(value.price.amount);
    const currency = value?.price?.currencyCode;
    const rawCompare = value?.compareAtPrice == null || value.compareAtPrice.amount == null
      ? NaN : Number(value.compareAtPrice.amount);
    // Shopify can return an invalid optional compare-at amount for a variant.
    // Keep its valid selling price; invalid sale metadata must not stop an
    // entire market-price backfill.
    const compare = Number.isFinite(rawCompare) && rawCompare >= 0 && value.compareAtPrice.currencyCode === currency
      ? rawCompare : null;
    if (!Number.isFinite(price) || price < 0 || !CURRENCY.test(currency || '')) {
      throw Error(`Incomplete contextual price for ${country}`);
    }
    prices[country] = { price, compareAtPrice: compare, currency };
  }
  return prices;
}

export function productMarketPriceRanges(variants, countries) {
  const ranges = {};
  for (const country of marketCountries(countries)) {
    const values = variants.map(variant => variant.marketPrices?.[country]).filter(Boolean);
    if (!values.length || values.length !== variants.length) continue;
    const currency = values[0].currency;
    if (!CURRENCY.test(currency || '') || values.some(value => value.currency !== currency || !Number.isFinite(Number(value.price)))) continue;
    ranges[country] = { min: Math.min(...values.map(value => Number(value.price))),
      max: Math.max(...values.map(value => Number(value.price))), currency };
  }
  return ranges;
}

// Numeric fields stay on the shared product document. A missing or incomplete
// country price never falls back to another market's amount.
export function productMarketPriceIndexFields(variants = []) {
  const countries = marketCountries(variants.flatMap(variant => Object.keys(variant.marketPrices || {}))
    .filter(country => COUNTRY.test(country)));
  const ranges = productMarketPriceRanges(variants, countries);
  const fields = Object.fromEntries(Object.entries(ranges).flatMap(([country, value]) => [
    [`marketPriceMin_${country}`, value.min],
    [`marketPriceMax_${country}`, value.max],
    [`marketPriceCurrency_${country}`, value.currency],
  ]));
  for (const country of countries) {
    if (!ranges[country]) continue;
    const available = variants.filter(variant => variant.available === true).map(variant => Number(variant.marketPrices?.[country]?.price));
    if (available.length && available.every(price => Number.isFinite(price) && price >= 0))
      fields[`marketAvailablePriceMin_${country}`] = Math.min(...available);
  }
  return fields;
}
