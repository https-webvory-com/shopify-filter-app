export function pinImageUrl(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text.startsWith('{')) {
      try { return pinImageUrl(JSON.parse(text)); } catch { return ''; }
    }
    return text === '[object Object]' || /^javascript:/i.test(text) ? '' : text;
  }
  if (value && typeof value === 'object') {
    let relative = '';
    for (const candidate of [value.url, value.src, value.imageUrl, value.image]) {
      const url = pinImageUrl(candidate);
      if (/^(https?:\/\/|\/\/|\/)/i.test(url)) return url;
      if (url && !relative) relative = url;
    }
    return relative;
  }
  return '';
}

export function catalogImageUrls(images) {
  let values = images;
  if (typeof values === 'string') {
    try { values = JSON.parse(values); } catch { values = [values]; }
  }
  if (typeof values === 'string') values = [values];
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(pinImageUrl).filter(Boolean))];
}
