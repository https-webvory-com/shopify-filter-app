import {createHash} from 'node:crypto';
export const configurationRevisionKey = shop => `collectionPreparationRevision:${shop}`;
export const productRevisionKey = (shop, collectionId) => `collectionProductRevision:${shop}:${String(collectionId || 'all').split('/').pop()}`;
const owned = ['globalSettings','mergedValues','filterGroup','quickViewSettings','queryParserFacets','availableVariants','variantEligibilityFilter','contextualPricing','collectionPreparedSequence','collectionPageIds','fullApiResponse','merch','pinning'];
const productCaches = ['queryParserFacets','availableVariants','contextualPricing','collectionPageIds'];
export function isOwnedShopCache(key, shop, productOnly = false) {
  return (productOnly ? productCaches : owned).some(prefix => key === `${prefix}:${shop}` || key.startsWith(`${prefix}:${shop}:`)) ||
    (!productOnly && key.startsWith(`api_filter_res_${shop}_`));
}
export function productRankingFingerprint(product) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['_vectors','updatedAt'].includes(key)).map(key => [key,stable(value[key])]));
    return value;
  };
  return createHash('sha256').update(JSON.stringify(stable(product))).digest('hex');
}
export function createShopCacheInvalidation({redis, warm = async()=>{}}) {
  return async function invalidate(shop, {kind = 'configuration', collectionIds = []} = {}) {
    const products = kind === 'products';
    const scopes = [...new Set(collectionIds.map(id=>String(id).split('/').pop()))].filter(id=>id!=='all');
    if (products) {for (const id of [...scopes,'all']) await redis.incr(productRevisionKey(shop,id));}
    else await redis.incr(configurationRevisionKey(shop));
    // Only delete owned cache namespaces. Queue hashes, locks and sorted sets,
    // snapshots, sessions and revisions are deliberately outside this allowlist.
    let cursor='0';let deleted=0;
    do {
      const [next, keys]=await redis.scan(cursor,'MATCH',`*${shop}*`,'COUNT',200);cursor=next;
      const removable=keys.filter(key=>isOwnedShopCache(key,shop,products));
      if(removable.length)deleted+=await redis.del(...removable);
    } while(cursor!=='0');
    await warm(shop, products ? [...scopes,'all'] : null);
    return {deleted,kind};
  };
}
