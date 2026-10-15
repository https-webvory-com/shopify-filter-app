import prisma from '../db.server';
import { validateSearchSettings } from '../utils/searchSettings.js';

export async function getSearchSettings(shop) {
  const row = await prisma.searchSetting.findUnique({ where: { shop } });
  return row ? validateSearchSettings(row.config) : null;
}

export async function saveSearchSettings(shop, input) {
  const config = validateSearchSettings(input);
  await prisma.searchSetting.upsert({ where: { shop }, create: { shop, config }, update: { config } });
  return config;
}

export async function resetSearchSettings(shop) {
  await prisma.searchSetting.deleteMany({ where: { shop } });
}
