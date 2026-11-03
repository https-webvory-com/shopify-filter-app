import { buildCollectionSequence, collectionRankingFields, hydrateCollectionPrices, hydrateCollectionInventory, hydrateCollectionSkus } from './rankedCollectionPage.js';
import {COLLECTION_SOURCE_FIELD,collectionFactResolver} from './collectionRuleFacts.js';

export async function prepareCollectionRanking(spec, { index, prisma, arrange, comparator, factProfile, loadFacts, captureReuse=false }) {
  const metadata = {};
  const native=captureReuse&&Array.isArray(spec.orderedIds)?new Set(spec.orderedIds.map(id=>String(id).split('/').pop())):null;
  let sourceOutsideIds=native?[]:null;
  const resolveFact=factProfile?collectionFactResolver(spec.rule,factProfile,spec.mergedValues):null;
  if(factProfile&&!resolveFact)throw Error('Collection rule facts do not cover this rule');
  const projectedFields=factProfile?[...new Set([...collectionRankingFields(spec.rule?.conditions||[],spec.sortBy,Array.isArray(spec.orderedIds)).filter(field=>!['variantPrices','options','images'].includes(field)),COLLECTION_SOURCE_FIELD,
    'cfpCollectionFactProfile','cfpCollectionFactSource','cfpCollectionFactMatches','cfpCollectionFactImages',
    ...(spec.priceSortField?[spec.priceSortField]:[])])]:spec.priceSortField
      ? [...new Set([...collectionRankingFields(spec.rule?.conditions||[],spec.sortBy,Array.isArray(spec.orderedIds)),spec.priceSortField])]
      : undefined;
  const withSortPrice=product=>{
    const price=Number(product[spec.priceSortField]);
    if(!Number.isFinite(price)||price<0)throw Error('Incomplete market price sort index');
    return {...product,priceMin:price};
  };
  const rankingIndex=spec.priceSortField?{...index,
    ...(typeof index.getDocuments==='function'?{getDocuments:async options=>{
      const response=await index.getDocuments({...options,fields:options.fields?[...new Set([...options.fields,spec.priceSortField])]:options.fields});
      return {...response,results:(response.results||[]).map(withSortPrice)};
    }}:{}),
    ...(typeof index.getDocument==='function'?{getDocument:async(...args)=>withSortPrice(await index.getDocument(...args))}:{}),
    search:async(...args)=>{
    const [query,options]=args;
    const response=await index.search(query,{...options,attributesToRetrieve:options?.attributesToRetrieve?
      [...new Set([...options.attributesToRetrieve,spec.priceSortField])]:options?.attributesToRetrieve});
    return {...response,hits:(response.hits||[]).map(withSortPrice)};
  }}:index;
  let comparatorPins=[];
  try {
    const pins=typeof spec.pinningRule?.products==='string'?JSON.parse(spec.pinningRule.products):spec.pinningRule?.products;
    if(Array.isArray(pins))comparatorPins=pins.map(p=>p?.id).filter(Boolean);
  } catch { /* Preserve the existing behavior for malformed legacy pin data. */ }
  const ids = await buildCollectionSequence(rankingIndex, {
    query: spec.query, conditions: spec.rule?.conditions ?? [], sortBy: spec.sortBy,
    pinnedIds: spec.pinnedIds, orderedIds: spec.orderedIds,
    projectedFields,
    ...(native?{observeCandidates:documents=>{for(const p of documents){
      const id=String(p.id).split('/').pop();
      if(sourceOutsideIds&&!p._rankingPinPlaceholder&&!native.has(id)){
        if(sourceOutsideIds.length===1000)sourceOutsideIds=null;else sourceOutsideIds.push(id);
      }
    }}}:{}),
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
  return { ids, metadata, ...(captureReuse?{sourceOutsideIds}:{}) };
}
