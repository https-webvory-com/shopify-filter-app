// Empty/legacy country lists mean a rule can affect every market. A targeted
// edit must refresh both its old and new markets, including removals.
export function merchandisingInvalidationOptions(before=[],after=[]) {
  const rules=[...before,...after];
  if(!rules.length||rules.some(rule=>!Array.isArray(rule?.countries)||!rule.countries.length))return undefined;
  const countries=[...new Set(rules.flatMap(rule=>rule.countries))];
  return countries.every(country=>/^[A-Z]{2}$/.test(country))?{kind:'market-rule',countries}:undefined;
}
