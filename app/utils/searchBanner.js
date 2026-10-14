import { normalizeRedirectQuery } from './searchRedirect.js';

export class BannerValidationError extends Error {}

export function validateBannerUrl(value, image = false) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return '';
  if (url.length > 2048 || /[\\\u0000-\u0020\u007f]/u.test(url) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(url)) throw new BannerValidationError('Enter a valid URL without spaces or control characters.');
  if (!/^https:\/\//i.test(url) && (image || !url.startsWith('/') || url.startsWith('//'))) throw new BannerValidationError(image ? 'Use a full HTTPS image URL.' : 'Use a store path or full HTTPS target URL.');
  let parsed;
  try { parsed = new URL(url, 'https://banner-validation.invalid'); } catch { throw new BannerValidationError('Enter a valid URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new BannerValidationError('Use HTTPS without login credentials.');
  return url;
}

export function validateSearchBanner(form) {
  const text = (key, max, required = false) => {
    const value = String(form.get(key) || '').trim();
    if (value.length > max || /[\u0000-\u001f\u007f]/u.test(value) || (required && !value)) throw new BannerValidationError(`Enter ${key} with ${required ? '1' : '0'}–${max} characters.`);
    return value;
  };
  const query = normalizeRedirectQuery(text('query', 200, true));
  if (query.length > 200) throw new BannerValidationError('Search query is too long.');
  const placement = form.get('placement');
  if (!['top', 'grid'].includes(placement)) throw new BannerValidationError('Choose Top or Product grid placement.');
  const position = placement === 'grid' ? Number(form.get('position')) : 1;
  if (!Number.isInteger(position) || position < 1 || position > 10000) throw new BannerValidationError('Product grid position must be a whole number from 1 to 10000.');
  const color = (key, fallback) => {
    const value = String(form.get(key) || fallback);
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new BannerValidationError('Use a six-digit hex color.');
    return value;
  };
  const imageUrl = validateBannerUrl(form.get('imageUrl'), true);
  const heading = text('heading', 200), content = text('content', 2000), description = text('description', 300), buttonLabel = text('buttonLabel', 80);
  const targetUrl = validateBannerUrl(form.get('targetUrl'));
  if (placement === 'top' && !imageUrl) throw new BannerValidationError('Top banners need an image URL.');
  if (!imageUrl && !heading && !content) throw new BannerValidationError('Add an image, heading or content.');
  if (buttonLabel && !targetUrl) throw new BannerValidationError('Add a target URL to use a button label.');
  return { query, placement, position, imageUrl, heading, content, description, buttonLabel, targetUrl, backgroundColor: color('backgroundColor', '#f4f4f5'), textColor: color('textColor', '#18181b') };
}
