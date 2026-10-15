import { Readable } from 'node:stream';
import { createBrotliCompress, createGzip, constants } from 'node:zlib';

// Opt-in transport only. Existing JSON consumers keep their full response.
export function canStreamCollection(request, { ranked, page, filtered, customerTags, search }) {
  const params = new URL(request.url).searchParams;
  const allowed = new Set(['shop', 'locale', 'language', 'country', 'collectionHandle', 'collectionId', 'sortBy', 'page', 'limit', 'rankingToken', 'responseMode']);
  return params.get('responseMode') === 'stream-v1' && ranked && page === 1 && !filtered && !customerTags && !search &&
    [...params.keys()].every(key => allowed.has(key)) && new Set(params.keys()).size === [...params.keys()].length;
}

export function packProducts(products) {
  return products.map(product => {
    if (!Array.isArray(product.variants) || Object.hasOwn(product, '__cfpVariantsV1')) return product;
    const keys = [...new Set(product.variants.flatMap(variant => Object.keys(variant).filter(key => variant[key] !== undefined)))];
    if (keys.length > 30) return product;
    const rows = product.variants.map(variant => {
      let mask = 0; const values = [];
      keys.forEach((key, index) => {
        if (Object.hasOwn(variant, key) && variant[key] !== undefined) { mask += 2 ** index; values.push(variant[key]); }
      });
      return [mask, ...values];
    });
    const { variants, ...rest } = product;
    return { ...rest, __cfpVariantsV1: { keys, rows } };
  });
}

// Mirror only the sidebar's existing tag selection. Counts, labels and order
// stay unchanged; the union preserves every value any enabled group can show.
export function compactCollectionFacets(facets, settings) {
  if (!Array.isArray(settings) || !Array.isArray(facets?.tags)) return facets;
  const groups = settings.filter(setting => setting.isEnabled && ['tag', 'tags'].includes(setting.filterType || setting.type));
  if (!groups.length) return facets;
  const configurations = [];
  for (const group of groups) {
    let config;
    try { config = typeof group.config === 'string' ? JSON.parse(group.config) : group.config; } catch { return facets; }
    if (!config || (config.prefix && typeof config.prefix !== 'string') ||
        (config.excludedValues && !Array.isArray(config.excludedValues)) ||
        (config.useManualValues && config.manualValues && (!Array.isArray(config.manualValues) || config.manualValues.some(value => typeof value !== 'string')))) return facets;
    configurations.push({
      prefix: (config.prefix || '').toLowerCase(),
      excluded: config.excludedValues || [],
      manual: config.useManualValues && config.manualValues?.length ? config.manualValues.map(value => value.toLowerCase().trim()) : null,
    });
  }
  return { ...facets, tags: facets.tags.filter(item => configurations.some(({ prefix, excluded, manual }) => {
    const raw = String(item.value || '');
    if (prefix && !raw.toLowerCase().startsWith(prefix)) return false;
    if (excluded.includes(item.value)) return false;
    if (!manual) return true;
    const value = raw.toLowerCase().trim(), trimmedPrefix = prefix.trim();
    const stripped = trimmedPrefix && value.startsWith(trimmedPrefix) ? value.slice(trimmedPrefix.length).trim() : value;
    return manual.includes(value) || manual.includes(stripped);
  })) };
}

export function collectionRecords(payload) {
  // Unfiltered cards do not expand selected option values. Their merge rules
  // can arrive with filters; filtered/search requests retain ordinary JSON.
  const { products, rankingToken, totalCount, contextualPricingApplied, globalSettings, ...rest } = payload;
  const metadata = { ...rest, facets: compactCollectionFacets(rest.facets, rest.settings) };
  return [
    { type: 'products', data: { products: packProducts(products), rankingToken, totalCount, contextualPricingApplied, globalSettings } },
    { type: 'complete', data: metadata },
  ];
}

function quality(header, encoding) {
  const entries = header.toLowerCase().split(',').map(part => part.trim().split(';'));
  const entry = entries.find(([name]) => name === encoding) || entries.find(([name]) => name === '*');
  if (!entry) return 0;
  const value = entry.slice(1).find(part => part.trim().startsWith('q='));
  const parsed = value == null ? 1 : Number(value.trim().slice(2));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : 0;
}

export function collectionStreamResponse(payload, request, headers) {
  const records = collectionRecords(payload);
  const source = Readable.from((function* () { for (const record of records) yield JSON.stringify(record) + '\n'; })(), { objectMode: false });
  const accepted = request.headers.get('accept-encoding') || '';
  let output = source, encoding;
  if (quality(accepted, 'br')) { encoding = 'br'; output = createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 }, flush: constants.BROTLI_OPERATION_FLUSH }); }
  else if (quality(accepted, 'gzip')) { encoding = 'gzip'; output = createGzip({ level: 3, flush: constants.Z_SYNC_FLUSH }); }
  if (output !== source) {
    source.on('error', error => output.destroy(error));
    output.on('close', () => source.destroy());
    source.pipe(output);
  }
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('Content-Type', 'application/x-ndjson; charset=utf-8');
  responseHeaders.set('X-Accel-Buffering', 'no');
  responseHeaders.append('Vary', 'Accept-Encoding');
  if (encoding) responseHeaders.set('Content-Encoding', encoding);
  return new Response(Readable.toWeb(output), { headers: responseHeaders });
}
