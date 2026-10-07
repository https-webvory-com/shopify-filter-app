export async function fetchCollectionBestSellingIds(admin, collectionId) {
  const ids = [];
  let cursor = null;
  do {
    const response = await admin.graphql(`
      query CollectionBestSelling($id: ID!, $cursor: String) {
        collection(id: $id) {
          products(first: 250, after: $cursor, sortKey: BEST_SELLING) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`, { variables: { id: collectionId, cursor } });
    const result = await response.json();
    if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join("; "));
    const connection = result.data?.collection?.products;
    if (!connection) throw new Error("Collection best-selling order is unavailable");
    ids.push(...connection.nodes.map(product => product.id));
    if (!connection.pageInfo.hasNextPage) break;
    const nextCursor = connection.pageInfo.endCursor;
    if (!nextCursor || nextCursor === cursor) throw new Error("Collection best-selling pagination did not advance");
    cursor = nextCursor;
  } while (true);
  return ids;
}

export function assignCollectionBestSellingRanks(products, ids) {
  const ranks = new Map(ids.map((id, rank) => [id, rank]));
  for (const product of products) {
    product.collectionBestSellingRank = ranks.get(product.id) ?? ids.length;
  }
}
