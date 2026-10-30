export function parseMarketRuleCountries(value) {
  const countries = [...new Set(String(value || '').split(/[\s,]+/u).map(item => item.trim().toUpperCase()).filter(Boolean))];
  if (countries.length > 30 || countries.some(country => !/^[A-Z]{2}$/.test(country)))
    throw Error('Enter up to 30 two-letter country codes, separated by commas');
  return countries;
}

export function ruleAppliesToCountry(rule, country) {
  const targets = Array.isArray(rule?.countries) ? rule.countries : [];
  return !targets.length || Boolean(country && targets.includes(String(country).toUpperCase()));
}
