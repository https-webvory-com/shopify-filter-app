// A highlighted matching word is not evidence that a natural-language query
// was misspelled. Only offer a close, single-word correction.
export function spellingCorrection(query, hits = [], semanticHitCount = 0) {
  const word = String(query || '').trim().toLowerCase();
  if (semanticHitCount || !/^[a-z]{4,}$/.test(word)) return null;
  const plainWords = hits.flatMap(hit => [hit.title, hit.vendor, hit.productType, ...(hit.tags || [])])
    .flatMap(text => String(text || '').toLowerCase().match(/[a-z]+/g) || []);
  if (plainWords.includes(word)) return null;
  const candidates = hits.flatMap(hit => Object.values(hit._formatted || {}))
    .flatMap(text => Array.isArray(text) ? text : [text])
    .flatMap(text => [...String(text).matchAll(/<em>([a-z]+)<\/em>/gi)].map(match => match[1].toLowerCase()));
  for (const candidate of candidates) {
    if (candidate === word || candidate.startsWith(word) || word.startsWith(candidate) || Math.abs(candidate.length - word.length) > 1) continue;
    let previous = Array.from({length:candidate.length + 1}, (_, index) => index);
    for (let i = 1; i <= word.length; i++) {
      const current = [i];
      for (let j = 1; j <= candidate.length; j++) current[j] = Math.min(current[j-1] + 1, previous[j] + 1, previous[j-1] + (word[i-1] === candidate[j-1] ? 0 : 1));
      previous = current;
    }
    if (previous[candidate.length] === 1) return candidate;
  }
  return null;
}
