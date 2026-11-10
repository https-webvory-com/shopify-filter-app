import prisma from '../db.server';

export async function listSearchCollections(shop, { query = '', after = '' } = {}) {
  const q = String(query).trim();
  if (q.length > 120 || after.length > 120 || /[\u0000-\u001f\u007f]/u.test(q + after)) throw Error('Invalid collection search.');
  const rows = await prisma.collection.findMany({
    where: { shop, ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { handle: { contains: q, mode: 'insensitive' } }] } : {}) },
    orderBy: [{ title: 'asc' }, { id: 'asc' }], take: 41,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    select: { id: true, title: true, handle: true, _count: { select: { products: true } }, products: {
      take: 1, orderBy: { productId: 'asc' }, where: { product: { shop, status: { in: ['ACTIVE', 'active'] } } },
      select: { product: { select: { images: true } } },
    } },
  });
  const page = rows.slice(0, 40);
  return { query: q, after, hasMore: rows.length > 40, nextCursor: rows.length > 40 ? page.at(-1).id : '', collections: page.map(row => {
    const images = row.products?.[0]?.product?.images;
    const first = Array.isArray(images) ? images[0] : null;
    const candidate = typeof first === 'string' ? first : first?.src || first?.url || '';
    let image = ''; try { const url = new URL(candidate); if (url.protocol === 'https:' && !url.username && !url.password) image = url.href; } catch {}
    return { id: /^\d+$/.test(row.id) ? 'gid://shopify/Collection/' + row.id : row.id, title: row.title, handle: row.handle, image, productCount: row._count?.products || 0 };
  }) };
}
