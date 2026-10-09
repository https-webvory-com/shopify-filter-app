// Read Shopify's collection-specific order, not a store-wide sales score.
export async function readCollectionBestSellingIds(admin, collectionId) {
  const ids = [];
  const seen = new Set();
  let cursor = null;
  do {
    const response = await admin.graphql(`#graphql
      query CollectionBestSellingOrder($id: ID!, $cursor: String) {
        collection(id: $id) {
          products(first: 250, after: $cursor, sortKey: BEST_SELLING) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`, {variables:{id:collectionId,cursor}});
    const json = await response.json();
    const products = json.data?.collection?.products;
    if (json.errors?.length || !products || typeof products.pageInfo?.hasNextPage !== 'boolean') throw new Error('Shopify collection order unavailable');
    for (const product of products.nodes) {
      const id = String(product.id).split('/').pop();
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
    if (!products.pageInfo.hasNextPage) return ids;
    if (!products.nodes.length || !products.pageInfo.endCursor || products.pageInfo.endCursor === cursor) throw new Error('Incomplete Shopify collection order');
    cursor = products.pageInfo.endCursor;
  } while (true);
}
