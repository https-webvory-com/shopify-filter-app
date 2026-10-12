const cleanId = id => String(id).split('/').pop();
const fullRankingFields = ['id', 'title', 'vendor', 'productType', 'tags', 'priceMin', 'inventoryTotal', 'variantPrices', 'options', 'images', 'collections', 'collection_titles', 'bestSellingScore', 'trendingScore', 'createdAt', 'rating', 'metafield_reviews.rating'];

export async function hydrateCollectionSkus(products, variantModel, shop) {
  const missing = products.filter(p => !p.variants?.length || p.variants.some(v => v.sku === undefined));
  for (let offset = 0; offset < missing.length; offset += 1000) {
    const batch = missing.slice(offset, offset + 1000);
    const rows = await variantModel.findMany({ where: { productId: { in: batch.map(p => p.id) }, product: {shop} }, select: { productId: true, id: true, sku: true, available: true, price: true, compareAtPrice: true, option1: true, option2: true, option3: true, imageUrl: true } });
    const grouped = new Map();
    for (const row of rows) { if (!grouped.has(row.productId)) grouped.set(row.productId, []); grouped.get(row.productId).push(row); }
    for (const product of batch) product.variants = (grouped.get(product.id) || []).map(row => ({
      ...(product.variants || []).find(v => cleanId(v.id) === cleanId(row.id)), ...row,
    }));
  }
}

export async function hydrateCollectionPrices(products, productModel, shop) {
  const missing = products.filter(p => p.priceMin == null || p.priceMin === '' || !Number.isFinite(Number(p.priceMin)));
  for (let offset = 0; offset < missing.length; offset += 1000) {
    const batch = missing.slice(offset, offset + 1000);
    const rows = await productModel.findMany({
      where: {shop, id: {in: batch.map(p => p.id)}}, select: {id: true, priceMin: true},
    });
    const prices = new Map(rows.map(row => [row.id, row.priceMin]));
    for (const product of batch) if (prices.has(product.id)) product.priceMin = prices.get(product.id);
  }
}

// Old index documents did not contain inventory. Never treat missing inventory
// as zero: a global sold-out exclusion would otherwise remove the whole store.
export async function hydrateCollectionInventory(products, variantModel) {
  const missing = products.filter(p => !Number.isFinite(p.inventoryTotal));
  for (let offset = 0; offset < missing.length; offset += 1000) {
    const batch = missing.slice(offset, offset + 1000);
    const rows = await variantModel.groupBy({
      by: ['productId'], where: {productId: {in: batch.map(p => p.id)}}, _sum: {inventory: true},
    });
    const totals = new Map(rows.map(row => [row.productId, row._sum.inventory ?? 0]));
    for (const product of batch) product.inventoryTotal = totals.get(product.id) ?? 0;
  }
}

export function collectionRankingFields(conditions, sortBy, hasShopifyOrder = true) {
  // Older callers retain the full projection. Tag-only collections must not
  // transfer tens of thousands of products' variant arrays just to rank IDs.
  if (!Array.isArray(conditions)) return fullRankingFields;
  const fields = new Set(['id']);
  if (['best-selling', 'bestselling'].includes(sortBy)) fields.add('priceMin');
  if (!hasShopifyOrder && ['best-selling', 'bestselling'].includes(sortBy)) fields.add('bestSellingScore');
  if (sortBy?.startsWith('price')) fields.add('priceMin');
  if (['created-ascending', 'created-descending'].includes(sortBy)) fields.add('createdAt');
  if (['title-ascending', 'title-descending'].includes(sortBy)) fields.add('title');
  if (sortBy && !['best-selling', 'bestselling', 'price-ascending', 'price-descending', 'created-ascending', 'created-descending', 'title-ascending', 'title-descending'].includes(sortBy)) return fullRankingFields;
  for (const condition of conditions) {
    const field = (condition.field || '').toLowerCase();
    const simple = { tags: ['tags'], vendor: ['vendor'], 'product type': ['productType'], product: ['title'], collections: ['collections', 'collection_titles'], price: ['priceMin'], date: ['createdAt'], sku: ['variantPrices'], rating: ['rating', 'metafield_reviews.rating'], id: [] };
    if (field in simple) simple[field].forEach(value => fields.add(value));
    else if (field === 'available') fields.add('inventoryTotal');
    else if (['discount', 'percent sales'].includes(field) || /option|color|size|title/.test(field)) {
      ['variantPrices', 'options', 'images'].forEach(value => fields.add(value));
    } else return fullRankingFields;
  }
  return [...fields];
}

// Rank and exclude the complete eligible set before allocating any page slots.
export async function buildCollectionSequence(index, { query, pinnedIds, orderedIds, arrange, conditions, sortBy, hydrateRanking }) {
  const { indexUid, q, ...options } = query;
  const documents = [];
  const seen = new Set();
  const batchSize = 1000;
  for (let offset = 0; ; offset += batchSize) {
    const result = await index.search(q, {
      ...options, offset, limit: batchSize,
      attributesToRetrieve: collectionRankingFields(conditions, sortBy, Array.isArray(orderedIds)),
    });
    for (const product of result.hits) {
      const id = cleanId(product.id);
      if (seen.has(id)) throw new Error('Collection changed while ranking; retry the request');
      seen.add(id);
      documents.push({ ...product, id });
    }
    if (result.hits.length < batchSize) {
      const expected = result.totalHits ?? result.estimatedTotalHits;
      if (expected != null && documents.length !== expected) throw new Error('Incomplete collection ranking results');
      break;
    }
  }
  const ranks = orderedIds ? new Map(orderedIds.map((id, rank) => [cleanId(id), rank])) : null;
  if (ranks) documents.sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
  // Valid pins awaiting indexing must retain their slots for DB hydration.
  for (const id of pinnedIds.map(cleanId)) {
    if (!seen.has(id)) { documents.push({ id }); seen.add(id); }
  }
  const products = documents.map((p, i) => ({
    ...p, id: `gid://shopify/Product/${p.id}`, _originalIndex: i,
    variants: p.variantPrices || [],
    collections: p.collection_titles?.map(title => ({ collection: { title } })) || p.collections || [],
  }));
  if (hydrateRanking) await hydrateRanking(products);
  const ranked = arrange(products);
  // Partition the complete ranking before pagination. Keep Shopify's relative
  // order in each group; unknown prices must not be treated as free products.
  if (ranks && ['best-selling', 'bestselling'].includes(sortBy)) {
    const isFree = product => product.priceMin != null && product.priceMin !== '' &&
      Number.isFinite(Number(product.priceMin)) && Number(product.priceMin) === 0;
    return [...ranked.filter(product => !isFree(product)), ...ranked.filter(isFree)]
      .map(product => cleanId(product.id));
  }
  return ranked.map(product => cleanId(product.id));
}

export async function readRankedCollectionPage(index, { ids, page, limit, attributes }) {
  const selected = ids.slice((page - 1) * limit, page * limit);
  const documents = new Map();
  for (let offset = 0; offset < selected.length; offset += 8) {
    await Promise.all(selected.slice(offset, offset + 8).map(async id => {
      try {
        const product = await index.getDocument(id, { fields: attributes });
        if (product.status && product.status.toUpperCase() !== 'ACTIVE') {
          throw new Error('Collection ranking session expired; product eligibility changed');
        }
        documents.set(id, product);
      }
      catch (error) {
        if (error.code !== 'document_not_found') throw error;
        documents.set(id, { id }); // Hydrate from DB without moving later page slots.
      }
    }));
  }
  return { hits: selected.map(id => documents.get(id)), total: ids.length };
}
