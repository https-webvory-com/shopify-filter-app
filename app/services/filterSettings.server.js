import prisma from "../db.server";
import { invalidateShop } from "./shopCache.server";
import {FILTER_WIDTH_KEYS,isValidFilterWidth,normalizeFilterWidth} from '../utils/filterWidths.js';

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
    drawerWidth: normalizeFilterWidth(integrations.drawerWidth),
    verticalFilterWidth: normalizeFilterWidth(integrations.verticalFilterWidth),
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
  for (const key of FILTER_WIDTH_KEYS) {
    if (data[key] === undefined) continue;
    if (!isValidFilterWidth(data[key])) throw Error('Filter widths must be whole numbers from 240 to 600 px');
    updateData[key] = Number(data[key]);
  }

  const presentationKeys = ['showQuickViewCollectionMobile', 'showQuickViewInstantSearchMobile', 'filterBarBackgroundColor', 'priceFilterDisplayMode', 'sizeOptionsPerRow', ...FILTER_WIDTH_KEYS];
  if (typeof data.desktopFilterLayout === 'string' || presentationKeys.some(key => data[key] !== undefined) || typeof data.horizontalFilters === 'boolean') {
    const current = await prisma.filterGlobalSetting.findUnique({
      where: { shop },
      select: { integrations: true },
    });
    const currentIntegrations = (current?.integrations && typeof current.integrations === 'object') ? current.integrations : {};
    updateData.integrations = {
      ...currentIntegrations,
      ...Object.fromEntries(presentationKeys.filter(key => updateData[key] !== undefined).map(key => [key, updateData[key]])),
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
  
  const appearanceOnly = ['desktopFilterLayout','horizontalFilters','mobileFilterLayout','drawerWidth','verticalFilterWidth',
    'filterBarBackgroundColor','sizeOptionsPerRow','showAttributeBasedBreadcrumb','showProductCount','scrollUpOnFilterValuesChange'];
  const keys = Object.keys(data);
  await invalidateShop(shop, keys.length && keys.every(key => appearanceOnly.includes(key)) ? {kind:'presentation'} : undefined);
  return {
    ...settings,
    filterBarBackgroundColor: settings.integrations?.filterBarBackgroundColor,
    drawerWidth: normalizeFilterWidth(settings.integrations?.drawerWidth),
    verticalFilterWidth: normalizeFilterWidth(settings.integrations?.verticalFilterWidth),
    desktopFilterLayout: settings.integrations?.desktopFilterLayout || updateData.integrations?.desktopFilterLayout || (settings.horizontalFilters ? 'horizontal' : 'drawer'),
  };
}
