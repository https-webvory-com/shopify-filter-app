import prisma from "../db.server";
import { getCached } from "../services/shopCache.server";
import { rateLimit } from "../services/rateLimiter.server";

// Public storefront configuration, consistent with the existing search/filter APIs.
// Return only storefront flags; never create shop rows from this public endpoint.
export const loader = async ({ request }) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) {
    return Response.json({ error: "Invalid shop" }, { status: 400, headers });
  }
  if (!(await rateLimit(request))) return Response.json({ error: "Too many requests" }, { status: 429, headers });
  const settings = await getCached(`quickViewSettings:${shop}`, () => prisma.filterGlobalSetting.findUnique({ where: { shop } }));
  return Response.json({
    quickViewStyle: settings?.quickViewStyle === "theme" ? "theme" : "app",
    showQuickViewSizeChart: settings?.showQuickViewSizeChart === true,
    quickViewInstantSearchStyle: (settings?.quickViewInstantSearchStyle ?? settings?.quickViewStyle) === "theme" ? "theme" : "app",
    showQuickViewInstantSearchSizeChart: (settings?.showQuickViewInstantSearchSizeChart ?? settings?.showQuickViewSizeChart) === true,
    showQuickViewCollection: settings?.showQuickViewCollection !== false,
    showQuickViewInstantSearch: settings?.showQuickViewInstantSearch !== false,
    showQuickViewCollectionMobile: (settings?.integrations?.showQuickViewCollectionMobile ?? settings?.showQuickViewCollection) !== false,
    showQuickViewInstantSearchMobile: (settings?.integrations?.showQuickViewInstantSearchMobile ?? settings?.showQuickViewInstantSearch) !== false,
    isWholesale: settings?.isWholesale === true,
  }, { headers });
};
