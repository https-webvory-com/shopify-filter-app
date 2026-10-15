import { Script } from 'node:vm';
import prisma from '../db.server';
import { CustomizationValidationError, normalizeThemeId, validateCustomization } from '../utils/customization.js';

export async function getCustomization(shop, themeId) {
  const row = await prisma.themeCustomization.findUnique({ where: { shop_themeId: { shop, themeId: normalizeThemeId(themeId) } } });
  return row ? validateCustomization(row.config) : null;
}
export async function saveCustomization(shop, themeId, input) {
  themeId = normalizeThemeId(themeId);
  const config = validateCustomization(input);
  if (config.javascript.trim()) {
    try { new Script(`(function(){\n${config.javascript}\n})`); }
    catch { throw new CustomizationValidationError('JavaScript contains a syntax error. Correct it before saving.'); }
  }
  await prisma.themeCustomization.upsert({ where: { shop_themeId: { shop, themeId } }, create: { shop, themeId, config }, update: { config } });
  return config;
}
export async function resetCustomization(shop, themeId) {
  await prisma.themeCustomization.deleteMany({ where: { shop, themeId: normalizeThemeId(themeId) } });
}
