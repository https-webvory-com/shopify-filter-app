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

const sameIds = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

// A submitted index task or a product count cannot prove relationships were saved.
export async function verifyMembershipWrites(db, index, shop, products, documents) {
  if (!products.length) return;
  const rows = await db.product.findMany({where:{shop,id:{in:products.map(p=>p.id)}},select:{id:true,collections:{select:{collectionId:true}}}});
  const hits = (await index.search('', {filter:[`shop = ${JSON.stringify(shop)}`, `id IN [${products.map(p=>JSON.stringify(p.id.split('/').pop())).join(',')}]`],limit:products.length,attributesToRetrieve:['id','shop','collections']})).hits;
  for (const product of products) {
    const row = rows.find(p=>p.id===product.id), doc = documents.find(p=>String(p.id)===product.id.split('/').pop());
    const indexed = hits.find(p=>String(p.id)===product.id.split('/').pop());
    if (!row || !doc || !indexed || indexed.shop!==shop ||
        !sameIds(row.collections.map(c=>c.collectionId),product.collections.nodes.map(c=>c.id)) ||
        !sameIds(indexed.collections || [],doc.collections || [])) {
      throw new Error('Product membership verification failed; sync checkpoint was not advanced');
    }
  }
}
