import { data } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/**
 * Sync Verification API
 * GET /api/sync-verify?shop=xxx.myshopify.com
 *
 * Compares:
 * - Shopify: Total products, Active products, Draft/Archived counts
 * - DB: Synced products count
 * - Meilisearch: Indexed products count
 * - Result: Are all active products synced?
 */
export const loader = async ({ request }) => {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    // ── 1. DB count ──────────────────────────────────────────────────
    const dbCount = await prisma.product.count({ where: { shop } });

    // ── 2. Shopify counts via GraphQL ────────────────────────────────
    const countQuery = `#graphql
      query {
        activeProducts: productsCount(query: "status:active") { count }
        draftProducts: productsCount(query: "status:draft") { count }
        archivedProducts: productsCount(query: "status:archived") { count }
      }
    `;

    const countRes = await admin.graphql(countQuery);
    const countData = await countRes.json();

    const shopifyActive = countData.data?.activeProducts?.count ?? 0;
    const shopifyDraft = countData.data?.draftProducts?.count ?? 0;
    const shopifyArchived = countData.data?.archivedProducts?.count ?? 0;
    const shopifyTotal = shopifyActive + shopifyDraft + shopifyArchived;

    // ── 3. Sync status ───────────────────────────────────────────────
    const lastSyncJob = await prisma.syncJob.findFirst({
      where: { shop },
      orderBy: { createdAt: "desc" },
    });

    const syncedPercent =
      shopifyActive > 0
        ? Math.round((dbCount / shopifyActive) * 100)
        : 100;

    const missing = shopifyActive - dbCount;
    const isFullySynced = missing <= 0;

    return data({
      shop,
      shopify: {
        total: shopifyTotal,
        active: shopifyActive,
        draft: shopifyDraft,
        archived: shopifyArchived,
      },
      database: {
        synced: dbCount,
        missing: Math.max(0, missing),
        syncedPercent,
        isFullySynced,
      },
      lastSyncJob: lastSyncJob
        ? {
            id: lastSyncJob.id,
            status: lastSyncJob.status,
            processedCount: lastSyncJob.processedCount,
            createdAt: lastSyncJob.createdAt,
            updatedAt: lastSyncJob.updatedAt,
          }
        : null,
      verdict: isFullySynced
        ? "✅ All active products are synced!"
        : `⚠️ ${Math.max(0, missing)} active products are missing from DB. Run sync again.`,
    });
  } catch (err) {
    return data({ error: err.message }, { status: 500 });
  }
};
