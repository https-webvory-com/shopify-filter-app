export const navigationCollectionsHelp = 'Turn collection choices into links that open the selected collection page, rather than filtering the current results. Choose the destinations under Main collection; manual values are not required. The links appear only on pages assigned to this filter group and using the app’s filter block.';

function configFor(filter) {
  try { const config = typeof filter.config === 'string' ? JSON.parse(filter.config) : filter.config; return config && typeof config === 'object' && !Array.isArray(config) ? config : {}; } catch { return {}; }
}
export const isCollectionNavigation = filter => filter?.filterType === 'collection' && configFor(filter).navCollections === true;
export function navigationCollectionTitles(config) {
  const main = Array.isArray(config.mainCollections) ? config.mainCollections.map(item => item?.collection).filter(value => typeof value === 'string' && value.trim()) : [];
  const fallback = config.useManualValues && Array.isArray(config.manualValues) ? config.manualValues.filter(value => typeof value === 'string' && value.trim()) : [];
  return [...new Set(main.length ? main : fallback)];
}

export async function resolveCollectionNavigation(settings, findCollections) {
  if (!Array.isArray(settings)) return settings;
  const names = [...new Set(settings.filter(filter => filter.isEnabled && isCollectionNavigation(filter)).flatMap(filter => navigationCollectionTitles(configFor(filter))))];
  const rows = names.length ? await findCollections(names) : [];
  return settings.map(filter => {
    if (!filter.isEnabled || !isCollectionNavigation(filter)) return filter;
    const config = configFor(filter);
    const navigationLinks = navigationCollectionTitles(config).flatMap(title => {
      const matches = rows.filter(row => row.title === title && typeof row.handle === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(row.handle));
      // Never guess a handle from a label or choose an ambiguous collection.
      return matches.length === 1 ? [{ label: title, handle: matches[0].handle }] : [];
    });
    return { ...filter, config: { ...config, navigationLinks } };
  });
}

export function hasUsableCollectionNavigation(payload) {
  return !Array.isArray(payload?.settings) || payload.settings.every(filter => !filter.isEnabled || !isCollectionNavigation(filter) || Array.isArray(configFor(filter).navigationLinks));
}
