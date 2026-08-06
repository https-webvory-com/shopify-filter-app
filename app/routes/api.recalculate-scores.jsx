/**
 * api.recalculate-scores.jsx
 * 
 * Internal API endpoint to recalculate bestSellingScore + trendingScore
 * from existing DB data and push updated values to Meilisearch.
 * Does NOT require a full order re-sync.
 * 
 * GET /api/recalculate-scores?shop=thedressoutlet.myshopify.com&secret=recalc2024
 */

import prisma from "../db.server.js";
import meiliClient from "../services/meiliClient.server.js";
import { calculateProductScores } from "../services/orders.server.js";

const SECRET = "recalc2024";

export async function loader({ request }) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const secret = url.searchParams.get("secret");

  if (secret !== SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!shop) {
    return Response.json({ error: "shop param required" }, { status: 400 });
  }

  try {
    // Fetch ALL products for this shop with their current metrics
    const products = await prisma.product.findMany({
      where: { shop },
      select: {
        id: true,
        unitsLifetime: true,    // All-time lifetime units sold
        unitsSold60Days: true,
        unitsSold7Days: true,
        grossRevenue: true,
        orderCount: true,
      }
    });

    console.log(`[Recalculate] Found ${products.length} products for ${shop}`);

    if (products.length === 0) {
      return Response.json({ error: "No products found for shop" }, { status: 404 });
    }

    // Recalculate scores using NEW formula (pure volume-based, matches SoBooster)
    const updatedDocs = [];
    let updatedCount = 0;

    const BATCH_SIZE = 100;
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (p) => {
        const scores = calculateProductScores(
          p.unitsLifetime,      // all-time lifetime units (pure volume for bestSellingScore)
          p.unitsSold7Days,     // 7-day units for trending
          p.grossRevenue,       // revenue (not used in formula but kept for API compat)
          p.orderCount          // total orders
        );

        await prisma.product.update({
          where: { id: p.id },
          data: {
            bestSellingScore: scores.bestSellingScore,
            trendingScore: scores.trendingScore,
          }
        });

        // Prepare Meilisearch document
        const numericId = p.id.includes("/") ? p.id.split("/").pop() : p.id;
        updatedDocs.push({
          id: numericId,
          bestSellingScore: scores.bestSellingScore,
          trendingScore: scores.trendingScore,
        });

        updatedCount++;
      }));
    }

    // Push all updated scores to Meilisearch in batches of 1000
    const MEILI_BATCH = 1000;
    for (let i = 0; i < updatedDocs.length; i += MEILI_BATCH) {
      const batch = updatedDocs.slice(i, i + MEILI_BATCH);
      await meiliClient.index("products").updateDocuments(batch);
    }

    console.log(`[Recalculate] Done. Updated ${updatedCount} products in DB and Meilisearch.`);

    return Response.json({
      success: true,
      shop,
      productsUpdated: updatedCount,
      meiliDocsUpdated: updatedDocs.length,
      note: "Scores recalculated using pure volume-based formula (units sold only)"
    });

  } catch (error) {
    console.error("[Recalculate] Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
