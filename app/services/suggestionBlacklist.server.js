import prisma from '../db.server';
import { validateSuggestionBlacklist, SuggestionBlacklistValidationError } from '../utils/suggestionBlacklist.js';

export function getActiveSuggestionBlacklist(shop) {
  // Read fresh: editing suggestion rules must not invalidate product ranking.
  return prisma.searchSuggestionBlacklist.findMany({ where: { shop, isActive: true }, select: { term: true, operator: true } });
}

export async function saveSuggestionBlacklist(shop, form) {
  const intent = form.get('intent');
  const id = String(form.get('id') || '');
  const isActive = form.get('isActive');
  if (intent !== 'delete' && !['true', 'false'].includes(isActive)) throw new SuggestionBlacklistValidationError('Choose whether the rule is enabled.');
  if (intent === 'delete' || intent === 'toggle') {
    if (!id) throw new SuggestionBlacklistValidationError('Select a blacklist rule.');
    const result = intent === 'delete'
      ? await prisma.searchSuggestionBlacklist.deleteMany({ where: { id, shop } })
      : await prisma.searchSuggestionBlacklist.updateMany({ where: { id, shop }, data: { isActive: isActive === 'true' } });
    if (!result.count) throw new SuggestionBlacklistValidationError('Blacklist rule not found.');
    return;
  }
  if (!['create', 'update'].includes(intent)) throw new SuggestionBlacklistValidationError('Unknown blacklist action.');
  const data = { ...validateSuggestionBlacklist(form.get('term'), form.get('operator')), isActive: isActive === 'true' };
  if (intent === 'update') {
    if (!id) throw new SuggestionBlacklistValidationError('Select a blacklist rule.');
    await prisma.searchSuggestionBlacklist.update({ where: { id, shop }, data });
  } else {
    await prisma.searchSuggestionBlacklist.create({ data: { shop, ...data } });
  }
}
