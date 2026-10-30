// Keep the public instant-search card small without changing the data used by
// ranking, suggestions, color selection, or market price verification.
const CARD_FIELDS = [
  'id', 'title', 'handle', 'vendor', 'productType', 'images', 'options',
  'variants', 'priceMin', 'priceMax', 'available', 'inventoryTotal',
  'createdAt', 'merchandisingImage', 'selectedVariantId', 'searchColor',
  'searchColorImage', 'isPinned', 'badges', 'rating',
];

export function instantSearchCard(product) {
  const card = {};
  for (const key of CARD_FIELDS) {
    if (product[key] !== undefined) card[key] = product[key];
  }
  return card;
}

// Fetch only what the direct instant-search path needs. Rule-based ranking
// still fetches its own candidate data before the public projection runs.
export const INSTANT_SEARCH_INDEX_FIELDS = [
  ...CARD_FIELDS.filter(key => !['variants', 'selectedVariantId', 'searchColor', 'searchColorImage', 'isPinned', 'badges'].includes(key)),
  'variantPrices', 'status', 'tags',
];
