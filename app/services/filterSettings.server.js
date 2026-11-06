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
    priceFilterDisplayMode: integrations.priceFilterDisplayMode === 'Range' ? 'Range' : 'List',
    sizeOptionsPerRow: Number.isInteger(integrations.sizeOptionsPerRow) && integrations.sizeOptionsPerRow >= 2 && integrations.sizeOptionsPerRow <= 6 ? integrations.sizeOptionsPerRow : 4,
  };
}

/**
 * Update global filter settings for a shop
 */
export async function updateFilterGlobalSettings(shop, data) {
  const updateData = { ...data };

  const presentationKeys = ['filterBarBackgroundColor', 'priceFilterDisplayMode', 'sizeOptionsPerRow'];
  if (typeof data.desktopFilterLayout === 'string' || presentationKeys.some(key => data[key] !== undefined) || typeof data.horizontalFilters === 'boolean') {
    const current = await prisma.filterGlobalSetting.findUnique({
      where: { shop },
      select: { integrations: true },
    });
    const currentIntegrations = (current?.integrations && typeof current.integrations === 'object') ? current.integrations : {};
    updateData.integrations = {
      ...currentIntegrations,
      ...Object.fromEntries(presentationKeys.filter(key => data[key] !== undefined).map(key => [key, data[key]])),
      ...(typeof data.desktopFilterLayout === 'string' ? {desktopFilterLayout: data.desktopFilterLayout} :
        typeof data.horizontalFilters === 'boolean' ? {desktopFilterLayout: data.horizontalFilters ? 'horizontal' : 'drawer'} : {}),
    };
    if (typeof data.desktopFilterLayout === 'string') updateData.horizontalFilters = data.desktopFilterLayout === 'horizontal';
    delete updateData.desktopFilterLayout;
    for (const key of presentationKeys) delete updateData[key];
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
