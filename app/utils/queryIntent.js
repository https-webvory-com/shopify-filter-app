// Deterministic query intent. This module only recognizes explicit shopper
// language; catalog-backed facet matching happens in the query parser.
const amount = '(?:\\$|£|€)?\\s*(\\d{1,6}(?:\\.\\d{1,2})?)';
const maxPattern = new RegExp(`\\b(?:under|below|less than|up to)\\s*${amount}\\b`, 'iu');
const minPattern = new RegExp(`\\b(?:over|above|more than|at least)\\s*${amount}\\b`, 'iu');
const rangePattern = new RegExp(`\\bbetween\\s+${amount}\\s+(?:and|to)\\s+${amount}\\b`, 'iu');
const sizePattern = /\bsize\s*(\d{1,2}(?:w)?|xxs|xs|s|m|l|xl|xxl|2xl|3xl|4xl)\b/iu;
const cheapPattern = /\b(?:cheap|affordable|budget)\b/iu;

const value = raw => {
  const number = Number(raw);
  return Number.isFinite(number) && number > 0 && number <= 100000 ? number : null;
};

export function extractQueryIntent(query) {
  if (typeof query !== 'string' || query.length > 500) return null;
  let residual = query.trim().replace(/\s+/gu, ' ');
  if (!residual) return null;
  const intent = { residualQuery: residual, price: null, size: null, sortHint: null };
  const range = residual.match(rangePattern);
  if (range) {
    const min = value(range[1]), max = value(range[2]);
    if (min !== null && max !== null && min <= max) {
      intent.price = { min, max, maxExclusive: false };
      residual = residual.replace(range[0], ' ');
    }
  } else {
    const max = residual.match(maxPattern);
    if (max && value(max[1]) !== null) {
      intent.price = { min: null, max: value(max[1]), maxExclusive: /^(under|below|less than)\b/iu.test(max[0]) };
      residual = residual.replace(max[0], ' ');
    } else {
      const min = residual.match(minPattern);
      if (min && value(min[1]) !== null) {
        intent.price = { min: value(min[1]), max: null, maxExclusive: false };
        residual = residual.replace(min[0], ' ');
      }
    }
  }
  const size = residual.match(sizePattern);
  if (size) {
    intent.size = size[1].toUpperCase();
    residual = residual.replace(size[0], ' ');
  }
  const cheap = residual.match(cheapPattern);
  if (cheap) {
    intent.sortHint = 'price-ascending';
    residual = residual.replace(cheap[0], ' ');
  }
  intent.residualQuery = residual.replace(/\s+/gu, ' ').trim();
  return intent;
}
