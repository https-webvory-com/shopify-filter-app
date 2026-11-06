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
    filterBarBackgroundColor: integrations.filterBarBackgroundColor,
  };
}

/**
 * Update global filter settings for a shop
 */
export async function updateFilterGlobalSettings(shop, data) {
  const updateData = { ...data };

  if (typeof data.desktopFilterLayout === 'string' || typeof data.filterBarBackgroundColor === 'string' || typeof data.horizontalFilters === 'boolean') {
    const current = await prisma.filterGlobalSetting.findUnique({
      where: { shop },
      select: { integrations: true },
    });
    const currentIntegrations = (current?.integrations && typeof current.integrations === 'object') ? current.integrations : {};
    updateData.integrations = {
      ...currentIntegrations,
      ...(typeof data.filterBarBackgroundColor === 'string' ? {filterBarBackgroundColor: data.filterBarBackgroundColor} : {}),
      ...(typeof data.desktopFilterLayout === 'string' ? {desktopFilterLayout: data.desktopFilterLayout} :
        typeof data.horizontalFilters === 'boolean' ? {desktopFilterLayout: data.horizontalFilters ? 'horizontal' : 'drawer'} : {}),
    };
    if (typeof data.desktopFilterLayout === 'string') updateData.horizontalFilters = data.desktopFilterLayout === 'horizontal';
    delete updateData.desktopFilterLayout;
    delete updateData.filterBarBackgroundColor;
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
    filterBarBackgroundColor: settings.integrations?.filterBarBackgroundColor,
    desktopFilterLayout: settings.integrations?.desktopFilterLayout || updateData.integrations?.desktopFilterLayout || (settings.horizontalFilters ? 'horizontal' : 'drawer'),
  };
}
