import prisma from "../db.server";
import { invalidateShop } from "./shopCache.server";

/**
 * Get global filter settings for a shop
 * If none exists, creates a default one.
 */
export async function getFilterGlobalSettings(shop) {
  let settings = await prisma.filterGlobalSetting.findUnique({
    where: { shop },
  });

  if (!settings) {
    settings = await prisma.filterGlobalSetting.create({
      data: { shop },
    });
  }

  const integrations = (settings.integrations && typeof settings.integrations === 'object') ? settings.integrations : {};
  const desktopFilterLayout = integrations.desktopFilterLayout || (settings.horizontalFilters ? 'horizontal' : 'drawer');

  return {
    ...settings,
    desktopFilterLayout,
  };
}

/**
 * Update global filter settings for a shop
 */
export async function updateFilterGlobalSettings(shop, data) {
  const updateData = { ...data };

  if (typeof data.desktopFilterLayout === 'string') {
    const current = await prisma.filterGlobalSetting.findUnique({
      where: { shop },
      select: { integrations: true },
    });
    const currentIntegrations = (current?.integrations && typeof current.integrations === 'object') ? current.integrations : {};
    updateData.integrations = {
      ...currentIntegrations,
      desktopFilterLayout: data.desktopFilterLayout,
    };
    updateData.horizontalFilters = data.desktopFilterLayout === 'horizontal';
    delete updateData.desktopFilterLayout;
  } else if (typeof data.horizontalFilters === 'boolean') {
    const current = await prisma.filterGlobalSetting.findUnique({
      where: { shop },
      select: { integrations: true },
    });
    const currentIntegrations = (current?.integrations && typeof current.integrations === 'object') ? current.integrations : {};
    updateData.integrations = {
      ...currentIntegrations,
      desktopFilterLayout: data.horizontalFilters ? 'horizontal' : 'drawer',
    };
  }

  const settings = await prisma.filterGlobalSetting.upsert({
    where: { shop },
    update: updateData,
    create: {
      shop,
      ...updateData,
    },
  });
  
  await invalidateShop(shop);
  return {
    ...settings,
    desktopFilterLayout: settings.integrations?.desktopFilterLayout || updateData.integrations?.desktopFilterLayout || (settings.horizontalFilters ? 'horizontal' : 'drawer'),
  };
}
