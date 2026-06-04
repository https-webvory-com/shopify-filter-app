import prisma from "../db.server";

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

  return settings;
}

/**
 * Update global filter settings for a shop
 */
export async function updateFilterGlobalSettings(shop, data) {
  return await prisma.filterGlobalSetting.upsert({
    where: { shop },
    update: data,
    create: {
      shop,
      ...data,
    },
  });
}
