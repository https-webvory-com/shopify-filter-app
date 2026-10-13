import { buildCollectionSequence, hydrateCollectionPrices, hydrateCollectionInventory, hydrateCollectionSkus } from './rankedCollectionPage.js';

export async function prepareCollectionRanking(spec, { index, prisma, arrange, comparator }) {
  const metadata = {};
  let comparatorPins=[];
  try {
    const pins=typeof spec.pinningRule?.products==='string'?JSON.parse(spec.pinningRule.products):spec.pinningRule?.products;
    if(Array.isArray(pins))comparatorPins=pins.map(p=>p?.id).filter(Boolean);
  } catch { /* Preserve the existing behavior for malformed legacy pin data. */ }
  const ids = await buildCollectionSequence(index, {
    query: spec.query, conditions: spec.rule?.conditions ?? [], sortBy: spec.sortBy,
    pinnedIds: spec.pinnedIds, orderedIds: spec.orderedIds,
    compare: comparator?.(spec.sortBy,comparatorPins,{...spec.globalSettings,preserveCollectionBestSellingOrder:spec.needsShopifyOrder}),
    hydrateRanking: async products => {
      if (spec.needsShopifyOrder) await hydrateCollectionPrices(products, prisma.product, spec.shop);
      if (spec.rule?.conditions?.some(c => c.field === 'SKU')) await hydrateCollectionSkus(products, prisma.variant, spec.shop);
      if (spec.rule?.conditions?.some(c => c.field?.toLowerCase() === 'available')) await hydrateCollectionInventory(products, prisma.variant);
    },
    arrange: products => {
      const ranked = arrange(products, spec.rule, spec.sortBy, spec.pinningRule, spec.mergedValues,
        { ...spec.globalSettings, preserveCollectionBestSellingOrder: spec.needsShopifyOrder });
      for (const p of ranked) if (p.merchandisingScore || p.merchandisingImage) metadata[p.id.split('/').pop()] = {
        merchandisingScore: p.merchandisingScore, merchandisingImage: p.merchandisingImage,
      };
      return ranked;
    },
  });
  return { ids, metadata };
}
