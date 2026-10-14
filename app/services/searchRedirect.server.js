import prisma from '../db.server';
import { normalizeRedirectQuery, parseRedirectQueries, validateRedirectTarget, RedirectValidationError } from '../utils/searchRedirect.js';

export async function findSearchRedirect(shop, query) {
  const normalized = normalizeRedirectQuery(query);
  if (!normalized || normalized.length > 200) return null;
  const match = await prisma.searchRedirectQuery.findUnique({
    where: { shop_query: { shop, query: normalized } }, include: { redirect: true },
  });
  if (!match?.redirect?.isActive || match.redirect.shop !== shop) return null;
  return validateRedirectTarget(match.redirect.targetUrl);
}

export async function saveSearchRedirect(shop, form) {
  const intent = form.get('intent');
  const id = String(form.get('id') || '');
  if (intent === 'delete' || intent === 'toggle') {
    if (!id) throw new RedirectValidationError('Select a redirect.');
    const result = intent === 'delete'
      ? await prisma.searchRedirect.deleteMany({ where: { id, shop } })
      : await prisma.searchRedirect.updateMany({ where: { id, shop }, data: { isActive: form.get('isActive') === 'true' } });
    if (!result.count) throw new RedirectValidationError('Redirect not found.');
    return;
  }
  if (intent !== 'create' && intent !== 'update') throw new RedirectValidationError('Unknown redirect action.');
  const queries = parseRedirectQueries(form.get('queries'));
  const targetUrl = validateRedirectTarget(form.get('targetUrl'));
  const data = { targetUrl, isActive: form.get('isActive') === 'true',
    queries: { create: queries.map(query => ({ shop, query })) } };
  if (intent === 'update') {
    if (!id) throw new RedirectValidationError('Select a redirect.');
    // Explicitly delete before creating replacements. Prisma's nested write
    // order can otherwise delete newly created queries along with old ones.
    await prisma.$transaction(async transaction => {
      await transaction.searchRedirectQuery.deleteMany({ where: { redirectId: id, shop } });
      await transaction.searchRedirect.update({ where: { id, shop }, data });
    });
  } else {
    await prisma.searchRedirect.create({ data: { shop, ...data } });
  }
}
