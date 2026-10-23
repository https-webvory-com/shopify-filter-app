// Accept pasted hex values with or without the leading hash.
export function normalizeSwatchHex(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^#?(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(text)
    ? `#${text.replace(/^#/, '').toLowerCase()}` : null;
}
