import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * POST /api/import-pins-batch
 * Body: { rows: [...up to 50], ruleType: "collection" | "search" }
 * Each row (already mapped from CSV):
 *   externalId, active, collectionTitles[], products[{Id, Title, ImageUrl}],
 *   searchQuery, applyToSearchType
 */
export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const body = await request.json();
    const { rows = [], ruleType = "collection" } = body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return Response.json({ imported: 0, skipped: 0, errors: [] });
    }

    // ─── Batch-validate all product IDs at once ───────────────────────────
    const allProductIds = new Set();
    for (const row of rows) {
      for (const p of row.products || []) {
        const numericId = p.Id ?? p.id;
        if (numericId) {
          // Convert numeric ID → gid format for DB lookup
          const gid = String(numericId).includes("gid://")
            ? String(numericId)
            : `gid://shopify/Product/${numericId}`;
          allProductIds.add(gid);
        }
      }
    }

    const validProductsInDB = await prisma.product.findMany({
      where: { shop, id: { in: Array.from(allProductIds) } },
      select: { id: true, title: true, images: true },
    });
    const validProductMap = new Map(validProductsInDB.map((p) => [p.id, p]));

    // ─── Batch-validate collection titles at once ─────────────────────────
    const allCollectionTitles = new Set();
    for (const row of rows) {
      for (const t of row.collectionTitles || []) {
        if (t) allCollectionTitles.add(t);
      }
    }

    let validCollectionTitleSet = new Set();
    if (allCollectionTitles.size > 0) {
      const validCols = await prisma.collection.findMany({
        where: { shop, title: { in: Array.from(allCollectionTitles) } },
        select: { title: true },
      });
      validCollectionTitleSet = new Set(validCols.map((c) => c.title));
    }

    // ─── Process each row individually with try/catch ─────────────────────
    const importedIds = [];
    const skippedRows = [];

    for (const row of rows) {
      try {
        const externalId = row.externalId || "imported-row";

        // Map and validate products
        const validProducts = [];
        for (const p of row.products || []) {
          const numericId = p.Id ?? p.id;
          if (!numericId) continue;

          const gid = String(numericId).includes("gid://")
            ? String(numericId)
            : `gid://shopify/Product/${numericId}`;

          if (validProductMap.has(gid)) {
            const dbProduct = validProductMap.get(gid);
            const imgUrl = p.ImageUrl || p.imageUrl || (Array.isArray(dbProduct.images) && dbProduct.images[0]?.src) || "";
            validProducts.push({
              id: gid,
              title: p.Title || p.title || dbProduct.title || "",
              imageUrl: imgUrl,
              image: imgUrl, // Added image field for UI rendering
            });
          }
        }

        if (validProducts.length === 0) {
          skippedRows.push({
            id: externalId,
            reason: "No matching products found in database",
          });
          continue;
        }

        // Validate collections by title
        const validCollections = (row.collectionTitles || []).filter((t) =>
          validCollectionTitleSet.has(t)
        );

        // Determine applyToSearchType
        const applyToSearchType = row.applyToSearchType || "both";

        // Determine rule name and applyToAll
        let ruleName = "Imported Pin";
        let applyToAll = false;
        
        if (ruleType === "collection") {
          applyToAll = validCollections.length === 0;
          ruleName = validCollections.length > 0 ? validCollections.join(", ") : "All Collections";
        } else {
          ruleName = row.searchQuery || "All Searches";
        }
        
        // Ensure ruleName is not empty string
        if (!ruleName.trim()) {
          ruleName = `Imported ${ruleType === "collection" ? "Collection" : "Search"} Pin`;
        }

        // UPSERT — key for resume: (shop, name, ruleType)
        // Deduplicates across stores by collection name or search query!
        await prisma.pinnedProductRule.upsert({
          where: {
            shop_name_ruleType: {
              shop,
              name: ruleName,
              ruleType,
            },
          },
          update: {
            status: row.active !== false,
            collections: validCollections,
            products: validProducts,
            searchQueries: row.searchQuery ? [row.searchQuery] : [],
            applyToSearchType,
            applyToAll,
          },
          create: {
            shop,
            name: ruleName,
            status: row.active !== false,
            applyToAll,
            collections: validCollections,
            products: validProducts,
            searchQueries: row.searchQuery ? [row.searchQuery] : [],
            ruleType,
            applyToSearchType,
          },
        });

        importedIds.push(externalId);
      } catch (rowErr) {
        skippedRows.push({
          id: row.externalId || "unknown",
          reason: rowErr.message || "Unknown error",
        });
      }
    }

    return Response.json({
      imported: importedIds.length,
      skipped: skippedRows.length,
      errors: skippedRows,
    });
  } catch (err) {
    console.error("[import-pins-batch] Fatal error:", err);
    return Response.json(
      { imported: 0, skipped: 0, errors: [{ id: "batch", reason: err.message }] },
      { status: 500 }
    );
  }
};
