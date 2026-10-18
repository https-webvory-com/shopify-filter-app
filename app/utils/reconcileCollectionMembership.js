import {isStorefrontProduct} from './storefrontProduct.js';
const clean = id => String(id).split('/').pop();
const same = (a,b) => a.size===b.size && [...a].every(id=>b.has(id));

export async function readCanonicalCollectionMembers(admin, collectionId) {
  const ids=new Set(), cursors=new Set(),seenProducts=new Set();let cursor=null,total=null;
  do {
    const response=await admin.graphql(`query verifiedCollectionMembers($id:ID!,$cursor:String){collection(id:$id){id productsCount{count} products(first:250,after:$cursor){nodes{id status publishedAt} pageInfo{hasNextPage endCursor}}}}`,{variables:{id:collectionId,cursor}});
    const body=await response.json(), collection=body.data?.collection, page=collection?.products;
    if(body.errors?.length || collection?.id!==collectionId || !Array.isArray(page?.nodes) || typeof page.pageInfo?.hasNextPage!=='boolean')throw Error('Complete Shopify collection membership unavailable');
    const count=collection.productsCount?.count;
    if(!Number.isSafeInteger(count)||count<0||(total!==null&&count!==total))throw Error('Shopify collection count changed or is unavailable');total=count;
    for(const p of page.nodes){if(!/^gid:\/\/shopify\/Product\/\d+$/.test(p.id)||seenProducts.has(p.id))throw Error('Invalid or duplicate Shopify product identity');seenProducts.add(p.id);if(isStorefrontProduct(p))ids.add(p.id);}
    if(!page.pageInfo.hasNextPage){if(seenProducts.size!==total)throw Error('Incomplete Shopify collection membership');return ids;}
    const next=page.pageInfo.endCursor;
    if(!page.nodes.length||!next||cursors.has(next))throw Error('Shopify collection cursor did not advance');
    cursors.add(next);cursor=next;
  }while(true);
}

export async function readIndexedCollectionMembers(index,shop,collectionId) {
  const ids=new Set();let scanned=0;
  for(let offset=0;;offset+=1000){
    const result=await index.search('',{filter:[`shop = ${JSON.stringify(shop)}`,`collections = ${JSON.stringify(collectionId)}`],offset,limit:1000,attributesToRetrieve:['id','shop']});
    if(!Array.isArray(result.hits))throw Error('Indexed collection membership unavailable');
    for(const p of result.hits){const id=`gid://shopify/Product/${clean(p.id)}`;if(p.shop!==shop||ids.has(id))throw Error('Indexed collection changed during verification');ids.add(id);scanned++;}
    if(result.hits.length<1000){const total=result.totalHits??result.estimatedTotalHits;if(total!=null&&total!==scanned)throw Error('Incomplete indexed collection membership');return ids;}
  }
}

export async function reconcileCollectionMembership({db,index,shop,collectionId,admin,syncProduct}) {
  const collection=await db.collection.findUnique({where:{id:collectionId},select:{shop:true}});
  if(collection?.shop!==shop)throw Error('Collection ownership mismatch');
  // Finish the canonical read before considering any additions or removals.
  const expected=await readCanonicalCollectionMembers(admin,collectionId);
  const readDb=async()=>new Set((await db.productCollection.findMany({where:{collectionId,product:{shop}},select:{productId:true}})).map(p=>p.productId));
  const stored=await readDb(),indexed=await readIndexedCollectionMembers(index,shop,collectionId);
  const differences=new Set([...expected,...stored,...indexed].filter(id=>expected.has(id)!==stored.has(id)||expected.has(id)!==indexed.has(id)));
  for(const id of differences)await syncProduct(id);
  if(differences.size){
    // Collection changes can occur during repair. Retrying re-reads canonical data.
    const current=await readCanonicalCollectionMembers(admin,collectionId);
    if(!same(expected,current))throw Error('Shopify collection changed during reconciliation; retry');
    if(!same(current,await readDb())||!same(current,await readIndexedCollectionMembers(index,shop,collectionId)))throw Error('Collection membership repair did not verify');
  }
  return{verified:true,products:expected.size,repaired:differences.size};
}
