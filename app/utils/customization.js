export const DEFAULT_CUSTOMIZATION = Object.freeze({ enabled: false, css: '', javascript: '', javascriptEnabled: false, swatches: [] });
export class CustomizationValidationError extends Error {}
export function normalizeThemeId(value) {
  const id = String(value || '').replace(/^gid:\/\/shopify\/OnlineStoreTheme\//, '');
  if (!/^[1-9]\d{0,19}$/.test(id)) throw new CustomizationValidationError('Choose a valid theme.');
  return id;
}
export function validateCustomization(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CustomizationValidationError('Invalid customization.');
  const result = {};
  for (const key of ['enabled', 'javascriptEnabled']) {
    if (typeof input[key] !== 'boolean') throw new CustomizationValidationError('Invalid customization switch.');
    result[key] = input[key];
  }
  for (const key of ['css', 'javascript']) {
    if (typeof input[key] !== 'string' || input[key].length > 100000 || input[key].includes('\0')) throw new CustomizationValidationError(`${key === 'css' ? 'Stylesheet' : 'JavaScript'} must be text of at most 100,000 characters.`);
    result[key] = input[key];
  }
  if (!Array.isArray(input.swatches) || input.swatches.length > 200) throw new CustomizationValidationError('Use at most 200 filter swatches.');
  const names = new Set();
  result.swatches = input.swatches.map(value => {
    if (!value || typeof value.color !== 'string' || typeof value.hex !== 'string') throw new CustomizationValidationError('Invalid filter swatch.');
    const color = value.color.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!color || color.length > 100 || /[\u0000-\u001f\u007f]/.test(color)) throw new CustomizationValidationError('Swatch names must contain 1–100 characters.');
    if (!/^#[\da-f]{6}$/i.test(value.hex)) throw new CustomizationValidationError('Use a six-digit hex color, such as #123456.');
    const name = color.toLowerCase();
    if (names.has(name)) throw new CustomizationValidationError('Each filter swatch name must be unique.');
    names.add(name);
    return { color, hex: value.hex.toLowerCase() };
  });
  return result;
}
