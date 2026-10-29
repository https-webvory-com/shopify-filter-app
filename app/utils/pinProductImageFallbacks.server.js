import { catalogImageUrls } from './pinProductImages.js';

export async function pinProductImageFallbacks(prisma, shop, pins) {
  const ids = [...new Set((pins || []).map(pin => pin?.id).filter(Boolean))];
  if (!ids.length) return {};
  const rows = await prisma.product.findMany({
    where: { shop, id: { in: ids } },
    select: { id: true, images: true },
  });
  return Object.fromEntries(rows.map(row => [row.id, catalogImageUrls(row.images)]));
}
