const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;

export function catalogDrift(shopifyProducts, indexedProducts) {
  const shopify = new Map();
  for (const product of shopifyProducts) {
    if (!PRODUCT_GID.test(product?.id) || !['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(product.status)) {
      throw Error('Invalid Shopify catalog product');
    }
    if (shopify.has(product.id)) throw Error('Duplicate Shopify catalog product');
    shopify.set(product.id, product.status);
  }
  const indexed = new Map();
  for (const product of indexedProducts) {
    if (!PRODUCT_GID.test(product?.id) || !['ACTIVE', 'DRAFT', 'ARCHIVED'].includes(product.status)) {
      throw Error('Invalid indexed catalog product');
    }
    if (indexed.has(product.id)) throw Error('Duplicate indexed catalog product');
    indexed.set(product.id, product.status);
  }
  return {
    shopifyCount: shopify.size,
    indexedCount: indexed.size,
    missing: [...shopify.keys()].filter(id => !indexed.has(id)),
    extra: [...indexed.keys()].filter(id => !shopify.has(id)),
    statusMismatch: [...shopify.entries()].filter(([id, status]) => indexed.has(id) && indexed.get(id) !== status)
      .map(([id, shopifyStatus]) => ({ id, shopifyStatus, indexedStatus: indexed.get(id) })),
  };
}
