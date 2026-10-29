import {createHash} from 'node:crypto';
import {createCollectionDependencies} from './collectionDependencies.js';
import {createCollectionSalesDependencies} from './collectionSalesDependencies.js';
export const configurationRevisionKey = shop => `collectionPreparationRevision:${shop}`;
export const productRevisionKey = (shop, collectionId) => `collectionProductRevision:${shop}:${String(collectionId || 'all').split('/').pop()}`;
export const productContentRevisionKey=(shop,collectionId)=>`collectionProductContentRevision:${shop}:${String(collectionId||'all').split('/').pop()}`;
export const rankingDataRevisionKey = (shop, collectionId='all') => `collectionRankingDataRevision:${shop}:${String(collectionId||'all').split('/').pop()}`;
export const catalogPublicationInvalidatedAtKey=(shop,collectionId)=>`collectionPublicationInvalidatedAt:${shop}:${String(collectionId||'all').split('/').pop()}`;
export const configurationInvalidatedAtKey=shop=>`collectionConfigurationInvalidatedAt:${shop}`;
const owned = ['globalSettings','mergedValues','filterGroup','quickViewSettings','queryParserFacets','percentSale','extraFilterFacts','availableVariants','variantEligibilityFilter','contextualPricing','collectionPreparedSequence','collectionPreparedRetention','collectionFirstPage','collectionPageIds','fullApiResponse','merch','pinning','searchRankingCandidates'];
const productCaches = ['queryParserFacets','percentSale','extraFilterFacts','availableVariants','contextualPricing','collectionPageIds','searchRankingCandidates'];
export function isOwnedShopCache(key, shop, productOnly = false) {
  return (productOnly ? productCaches : owned).some(prefix => key === `${prefix}:${shop}` || key.startsWith(`${prefix}:${shop}:`)) ||
    (!productOnly && key.startsWith(`api_filter_res_${shop}_`));
}
export function productRankingFingerprint(product) {
  // Derived matching-cache metadata is not a product change. The complete
  // original variants/options/images remain in the fingerprint, so refreshing
  // a fact profile cannot invalidate overlapping rankings by itself.
  const derived=new Set(['cfpCollectionFactProfile','cfpCollectionFactSource','cfpCollectionFactMatches','cfpCollectionFactImages']);
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['_vectors','updatedAt'].includes(key)&&(value!==product||!derived.has(key))).map(key => [key,stable(value[key])]));
    return value;
  };
  return createHash('sha256').update(JSON.stringify(stable(product))).digest('hex');
}
export function productContentFingerprint(product){
 if(product==null)return productRankingFingerprint(product);
 const {bestSellingScore,trendingScore,cfpCollectionInputSource,...content}=product;
 return productRankingFingerprint(content);
}
export function createShopCacheInvalidation({redis, warm = async()=>{}}) {
  return async function invalidate(shop, {kind = 'configuration', collectionIds = [],externalProof} = {}) {
    const products = kind === 'products'||kind==='scores';
    const scopes = [...new Set(collectionIds.map(id=>String(id).split('/').pop()))].filter(id=>id!=='all');
    // Bulk/index or membership changes can alter inputs absent from a rule's
    // signature. Reject saved rankings for those scopes immediately.
    if(kind==='catalog')for(const id of scopes.length?scopes:['all'])await redis.incr(rankingDataRevisionKey(shop,id));
    if (products) {for (const id of [...scopes,'all']) await redis.incr(productRevisionKey(shop,id));}
    else if(kind==='catalog'&&scopes.length){
      // Collection webhooks already have a scoped ranking epoch. Do not make
      // every other collection's complete published page obsolete as well.
      for(const id of scopes)await redis.set(catalogPublicationInvalidatedAtKey(shop,id),String(Date.now()));
    }else{
      await redis.incr(configurationRevisionKey(shop));
      await redis.set(configurationInvalidatedAtKey(shop),String(Date.now()));
    }
    // Old copies continue to check globalProducts. New supported copies use
    // tag/pin dependencies, with a broad fallback for unproven/bulk writes.
    if(kind==='products')for(const id of [...scopes,'all'])await redis.incr(productContentRevisionKey(shop,id));
    if(kind==='products'&&typeof redis.set==='function')await createCollectionDependencies(redis).changed(shop,externalProof);
    if(kind==='scores'&&typeof redis.set==='function')await createCollectionSalesDependencies(redis).changed(shop,externalProof?.ids);
    // Only delete owned cache namespaces. Queue hashes, locks and sorted sets,
    // snapshots, sessions and revisions are deliberately outside this allowlist.
    let cursor='0';let deleted=0;
    do {
      const [next, keys]=await redis.scan(cursor,'MATCH',`*${shop}*`,'COUNT',200);cursor=next;
      const removable=keys.filter(key=>isOwnedShopCache(key,shop,products)&&
        !key.startsWith(`collectionPreparedSequence:${shop}:`)&&
        key!==`collectionPreparedRetention:${shop}`&&!key.startsWith(`collectionPreparedRetention:${shop}:`));
      if(removable.length)deleted+=await redis.del(...removable);
    } while(cursor!=='0');
    await warm(shop, products ? [...scopes,'all'] : kind==='catalog'&&scopes.length?scopes:null);
    return {deleted,kind};
  };
}
