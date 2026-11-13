import prisma from '../db.server';

const productCard=row=>{
  const first=Array.isArray(row.images)?row.images[0]:null;
  const candidate=typeof first==='string'?first:first?.src||first?.url||'';
  let image='';try{const url=new URL(candidate);if(url.protocol==='https:'&&!url.username&&!url.password)image=url.href;}catch{}
  return {id:row.id,title:row.title,image};
};
export async function listSearchProducts(shop,{query=''}={}){
  const q=String(query).trim();
  if(q.length>120||/[\u0000-\u001f\u007f]/u.test(q))throw Error('Invalid product search.');
  const rows=await prisma.product.findMany({where:{shop,status:{in:['ACTIVE','active']},...(q?{OR:[{title:{contains:q,mode:'insensitive'}},{handle:{contains:q,mode:'insensitive'}}]}:{})},orderBy:[{title:'asc'},{id:'asc'}],take:21,select:{id:true,title:true,images:true}});
  return {query:q,products:rows.slice(0,20).map(productCard),hasMore:rows.length>20};
}
export async function validateSelectedSearchProducts(shop,products){
  if(!products.length)return [];
  const rows=await prisma.product.findMany({where:{shop,id:{in:products.map(p=>p.id)},status:{in:['ACTIVE','active']}},select:{id:true,title:true,images:true}});
  const byId=new Map(rows.map(row=>[row.id,productCard(row)]));
  if(products.some(p=>!byId.has(p.id)))throw Error('One of the selected products is no longer active in this store. Remove it and save again.');
  return products.map(p=>byId.get(p.id));
}

export async function listSearchCollections(shop, { query = '', after = '' } = {}) {
  const q = String(query).trim();
  if (q.length > 120 || after.length > 120 || /[\u0000-\u001f\u007f]/u.test(q + after)) throw Error('Invalid collection search.');
  const rows = await prisma.collection.findMany({
    where: { shop, ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { handle: { contains: q, mode: 'insensitive' } }] } : {}) },
    orderBy: [{ title: 'asc' }, { id: 'asc' }], take: 41,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    select: { id: true, title: true, handle: true },
  });
  const page = rows.slice(0, 40);
  // Resolve metadata only for this page using the collectionId/productId index.
  // A nested relation query can aggregate memberships across the entire catalog.
  const details = page.length ? await prisma.$queryRaw`
    SELECT c."id",
      (SELECT COUNT(*)::integer FROM "ProductCollection" pc
       WHERE pc."collectionId" = c."id") AS "productCount",
      (SELECT p."images" FROM "ProductCollection" pc
       JOIN "Product" p ON p."id" = pc."productId"
       WHERE pc."collectionId" = c."id" AND p."shop" = ${shop}
         AND p."status" IN ('ACTIVE', 'active')
       ORDER BY pc."productId" ASC LIMIT 1) AS "images"
    FROM "Collection" c
    WHERE c."shop" = ${shop} AND c."id" = ANY(${page.map(row => row.id)}::text[])
  ` : [];
  const metadata = new Map(details.map(row => [row.id, row]));
  return { query: q, after, hasMore: rows.length > 40, nextCursor: rows.length > 40 ? page.at(-1).id : '', collections: page.map(row => {
    const detail = metadata.get(row.id);
    const images = detail?.images;
    const first = Array.isArray(images) ? images[0] : null;
    const candidate = typeof first === 'string' ? first : first?.src || first?.url || '';
    let image = ''; try { const url = new URL(candidate); if (url.protocol === 'https:' && !url.username && !url.password) image = url.href; } catch {}
    return { id: /^\d+$/.test(row.id) ? 'gid://shopify/Collection/' + row.id : row.id, title: row.title, handle: row.handle, image, productCount: detail?.productCount || 0 };
  }) };
}
