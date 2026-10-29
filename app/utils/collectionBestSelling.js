// Read Shopify's collection-specific order, not a store-wide sales score.
export async function readCollectionBestSellingIds(admin, collectionId, {retryDelayMs=500}={}) {
  const ids = [];
  const seen = new Set();
  let cursor = null;
  do {
    let products;
    for(let attempt=0;attempt<4;attempt++){
      let response,json;
      try{
        response = await admin.graphql(`#graphql
      query CollectionBestSellingOrder($id: ID!, $cursor: String) {
        collection(id: $id) {
          products(first: 250, after: $cursor, sortKey: BEST_SELLING) {
            nodes { id }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`, {variables:{id:collectionId,cursor}});
        json = await response.json();
      }catch(error){
        if(attempt===3)throw error;
        await new Promise(resolve=>setTimeout(resolve,retryDelayMs*2**attempt));
        continue;
      }
      products = json.data?.collection?.products;
      if(response.ok!==false&&!json.errors?.length&&products&&typeof products.pageInfo?.hasNextPage==='boolean')break;
      const errors=json.errors||[];
      const retryable=response.status===429||response.status>=500||errors.some(error=>
        ['THROTTLED','INTERNAL_SERVER_ERROR','SERVICE_UNAVAILABLE'].includes(error.extensions?.code)||/throttl|rate limit|temporarily unavailable/i.test(error.message||''));
      if(!retryable||attempt===3){
        const reason=errors.map(error=>error.extensions?.code||error.message).filter(Boolean).join(', ').slice(0,120);
        throw new Error(`Shopify collection order unavailable${reason?`: ${reason}`:''}`);
      }
      await new Promise(resolve=>setTimeout(resolve,retryDelayMs*2**attempt));
    }
    for (const product of products.nodes) {
      const id = String(product.id).split('/').pop();
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
    if (!products.pageInfo.hasNextPage) return ids;
    if (!products.nodes.length || !products.pageInfo.endCursor || products.pageInfo.endCursor === cursor) throw new Error('Incomplete Shopify collection order');
    cursor = products.pageInfo.endCursor;
  } while (true);
}
