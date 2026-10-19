import { buildCollectionSequence, collectionRankingFields, hydrateCollectionPrices, hydrateCollectionInventory, hydrateCollectionSkus } from './rankedCollectionPage.js';
import {COLLECTION_SOURCE_FIELD,collectionFactResolver} from './collectionRuleFacts.js';

export async function prepareCollectionRanking(spec, { index, prisma, arrange, comparator, factProfile, loadFacts }) {
  const metadata = {};
  const resolveFact=factProfile?collectionFactResolver(spec.rule,factProfile,spec.mergedValues):null;
  if(factProfile&&!resolveFact)throw Error('Collection rule facts do not cover this rule');
  const projectedFields=factProfile?[...new Set([...collectionRankingFields(spec.rule?.conditions||[],spec.sortBy,Array.isArray(spec.orderedIds)).filter(field=>!['variantPrices','options','images'].includes(field)),COLLECTION_SOURCE_FIELD])]:undefined;
  let comparatorPins=[];
  try {
    const pins=typeof spec.pinningRule?.products==='string'?JSON.parse(spec.pinningRule.products):spec.pinningRule?.products;
    if(Array.isArray(pins))comparatorPins=pins.map(p=>p?.id).filter(Boolean);
  } catch { /* Preserve the existing behavior for malformed legacy pin data. */ }
  const ids = await buildCollectionSequence(index, {
    query: spec.query, conditions: spec.rule?.conditions ?? [], sortBy: spec.sortBy,
    pinnedIds: spec.pinnedIds, orderedIds: spec.orderedIds,
    projectedFields,
    compare: comparator?.(spec.sortBy,comparatorPins,{...spec.globalSettings,preserveCollectionBestSellingOrder:spec.needsShopifyOrder}),
    hydrateRanking: async products => {
      if(loadFacts)await loadFacts(products.filter(product=>!product._rankingPinPlaceholder));
      if(resolveFact)for(const product of products){
        // Explicit pins not yet indexed retain their existing DB hydration path.
        if(product.cfpCollectionFactProfile)product._collectionRuleFact=resolveFact(product);
        else if(!product._rankingPinPlaceholder)throw Error('Collection ranking facts missing');
      }
      if (spec.needsShopifyOrder) await hydrateCollectionPrices(products, prisma.product, spec.shop);
      if (spec.rule?.conditions?.some(c => c.field === 'SKU')) await hydrateCollectionSkus(resolveFact?products.filter(p=>p._rankingPinPlaceholder):products, prisma.variant, spec.shop);
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
