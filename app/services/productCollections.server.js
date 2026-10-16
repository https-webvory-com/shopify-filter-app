/** Complete membership before any DB/index writes; failures leave existing data intact. */
export async function completeProductCollections(admin, product) {
  const initial = product.collections;
  if (!Array.isArray(initial?.nodes) || typeof initial.pageInfo?.hasNextPage !== 'boolean') {
    throw new Error('Missing product collection pagination metadata');
  }
  const nodes = [...initial.nodes];
  const seen = new Set();
  let pageInfo = initial.pageInfo;
  while (pageInfo.hasNextPage) {
    const cursor = pageInfo.endCursor;
    if (!cursor || seen.has(cursor)) throw new Error('Product collection cursor did not advance');
    seen.add(cursor);
    const response = await admin.graphql(`#graphql
      query productCollectionPage($id: ID!, $cursor: String!) {
        product(id: $id) {
          collections(first: 250, after: $cursor) {
            nodes { id title handle }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`, { variables: { id: product.id, cursor } });
    const result = await response.json();
    const page = result.data?.product?.collections;
    if (result.errors?.length || !Array.isArray(page?.nodes) || typeof page.pageInfo?.hasNextPage !== 'boolean') {
      throw new Error('Failed to fetch complete product collection membership');
    }
    nodes.push(...page.nodes);
    pageInfo = page.pageInfo;
  }
  product.collections = { nodes: [...new Map(nodes.map(node => [node.id, node])).values()], pageInfo };
  return product;
}
