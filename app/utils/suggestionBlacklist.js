export class SuggestionBlacklistValidationError extends Error {}

export function normalizeSuggestionTerm(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : '';
}

export function validateSuggestionBlacklist(term, operator) {
  const raw = typeof term === 'string' ? term : '';
  const normalized = normalizeSuggestionTerm(raw);
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f]/u.test(raw)) {
    throw new SuggestionBlacklistValidationError('Enter a suggestion term with 1–200 characters and no control characters.');
  }
  if (!['contains', 'exact'].includes(operator)) throw new SuggestionBlacklistValidationError('Choose Contains or Exact match.');
  return { term: normalized, operator };
}

export function filterBlacklistedSuggestions(suggestions, rules = []) {
  const active = rules.filter(rule => rule && rule.isActive !== false && ['contains', 'exact'].includes(rule.operator))
    .map(rule => ({ operator: rule.operator, term: normalizeSuggestionTerm(rule.term) })).filter(rule => rule.term);
  return suggestions.filter(suggestion => {
    const candidate = normalizeSuggestionTerm(suggestion);
    return !active.some(rule => rule.operator === 'exact' ? candidate === rule.term : candidate.includes(rule.term));
  });
}
