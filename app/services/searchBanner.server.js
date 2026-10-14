import prisma from '../db.server';
import { normalizeRedirectQuery } from '../utils/searchRedirect.js';
import { validateSearchBanner, BannerValidationError } from '../utils/searchBanner.js';

export async function getSearchBanners(shop, query) {
  const normalized = normalizeRedirectQuery(query);
  if (!normalized || normalized.length > 200) return [];
  // No product ranking/index invalidation: promotions are read independently.
  return prisma.searchBanner.findMany({ where: { shop, query: normalized, isActive: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true, placement: true, position: true, imageUrl: true, targetUrl: true, description: true, heading: true, content: true, buttonLabel: true, backgroundColor: true, textColor: true } });
}

export async function saveSearchBanner(shop, form) {
  const intent = form.get('intent'), id = String(form.get('id') || ''), active = form.get('isActive');
  if (intent !== 'delete' && !['true', 'false'].includes(active)) throw new BannerValidationError('Choose whether the banner is enabled.');
  if (['delete', 'toggle'].includes(intent)) {
    if (!id) throw new BannerValidationError('Select a banner.');
    const result = intent === 'delete' ? await prisma.searchBanner.deleteMany({ where: { id, shop } }) : await prisma.searchBanner.updateMany({ where: { id, shop }, data: { isActive: active === 'true' } });
    if (!result.count) throw new BannerValidationError('Banner not found.');
    return;
  }
  if (!['create', 'update'].includes(intent)) throw new BannerValidationError('Unknown banner action.');
  const data = { ...validateSearchBanner(form), isActive: active === 'true' };
  if (intent === 'update') {
    if (!id) throw new BannerValidationError('Select a banner.');
    await prisma.searchBanner.update({ where: { id, shop }, data });
  } else await prisma.searchBanner.create({ data: { shop, ...data } });
}
