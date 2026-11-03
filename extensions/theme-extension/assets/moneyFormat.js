(function () {
  const sample = String(window.cfpMoneySample || '');
  const match = /\d[\d.,\s\u00a0\u202f'’]*\d/u.exec(sample);
  const number = match?.[0]?.trim();
  const decimalMatch = number?.match(/([^\d])89$/u);
  const decimals = decimalMatch ? 2 : 0;
  const decimalSeparator = decimalMatch?.[1] || '.';
  const integer = decimalMatch ? number.slice(0, -3) : number;
  const groupMatch = integer?.match(/\d([^\d])\d{3}$/u);
  const groupSeparator = groupMatch?.[1] || ',';
  const groups = groupMatch ? integer.split(groupSeparator) : [];
  const locale = groups.length > 2 && groups.at(-2).length === 2 ? 'en-IN' : 'en-US';
  const prefix = match ? sample.slice(0, match.index) : '';
  const suffix = match ? sample.slice(match.index + match[0].length) : '';
  const numberFormat = match ? new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }) : null;

  window.cfpFormatMoney = function (amount) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return '';
    if (numberFormat) {
      const formatted = numberFormat.formatToParts(value).map(part =>
        part.type === 'group' ? groupSeparator :
          part.type === 'decimal' ? decimalSeparator : part.value
      ).join('');
      return prefix + formatted + suffix;
    }
    const currency = window.Shopify?.currency?.active || window.cfpCurrencyCode || 'USD';
    try { return new Intl.NumberFormat(document.documentElement.lang || 'en-US', { style: 'currency', currency }).format(value); }
    catch { return value.toFixed(2); }
  };
  window.cfpFormatMoneyCents = cents => window.cfpFormatMoney(Number(cents) / 100);
})();
