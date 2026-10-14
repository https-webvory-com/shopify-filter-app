export function normalizeRedirectQuery(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : '';
}

export class RedirectValidationError extends Error {}

export function validateRedirectTarget(value) {
  const target = typeof value === 'string' ? value.trim() : '';
  if (!target || target.length > 2048 || /[\\\u0000-\u0020\u007f]/u.test(target) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(target)) {
    throw new RedirectValidationError('Enter a valid destination URL without spaces or control characters.');
  }
  if (!(target.startsWith('/') && !target.startsWith('//')) && !/^https:\/\//i.test(target)) {
    throw new RedirectValidationError('Use a store path starting with / or a full HTTPS URL.');
  }
  let url;
  try { url = new URL(target, 'https://redirect-validation.invalid'); }
  catch { throw new RedirectValidationError('Enter a valid destination URL.'); }
  if (url.username || url.password || url.protocol !== 'https:') throw new RedirectValidationError('Enter a valid HTTPS URL without login credentials.');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { throw new RedirectValidationError('Enter a valid destination URL.'); }
  if (/\/search\/?$/i.test(pathname)) throw new RedirectValidationError('Choose a destination other than a search page to avoid redirect loops.');
  return target;
}

export function parseRedirectQueries(value) {
  const queries = [...new Set(String(value || '').split(/\r?\n/).map(normalizeRedirectQuery).filter(Boolean))];
  if (!queries.length || queries.length > 50 || queries.some(query => query.length > 200 || /[\u0000-\u001f\u007f]/u.test(query))) {
    throw new RedirectValidationError('Enter 1–50 search queries, one per line, with up to 200 characters each.');
  }
  return queries;
}
