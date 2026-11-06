export function priceFilterDisplayMode(settings = {}) {
  return (settings?.priceFilterDisplayMode ?? settings?.integrations?.priceFilterDisplayMode) === 'Range' ? 'Range' : 'List';
}

export function normalizePriceFilter(filter, settings = {}) {
  if ((filter?.filterType || filter?.type) !== 'price') return filter;
  let config;
  try { config = typeof filter.config === 'string' ? JSON.parse(filter.config) : filter.config; } catch {}
  config = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  return {...filter, displayMode: priceFilterDisplayMode(settings), config: {...config,
    // Match the existing editor defaults only when no saved bands exist.
    priceRanges: Array.isArray(config.priceRanges) ? config.priceRanges : [
      {label:'{0} - {1}',from:0,to:10}, {label:'From {0}',from:10,to:''},
    ],
  }};
}
