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
    const allCollectionIds = new Set();
    const collectionGid = id => String(id).startsWith("gid://shopify/Collection/") ? String(id) : `gid://shopify/Collection/${id}`;
    for (const row of rows) {
      for (const id of row.collectionIds || []) {
        if (id) allCollectionIds.add(collectionGid(id));
      }
      for (const t of row.collectionTitles || []) {
        if (t) allCollectionTitles.add(t);
      }
    }

    let validCollectionTitleSet = new Set();
    let collectionTitlesById = new Map();
    if (allCollectionTitles.size > 0 || allCollectionIds.size > 0) {
      const validCols = await prisma.collection.findMany({
        where: { shop, OR: [{ title: { in: Array.from(allCollectionTitles) } }, { id: { in: Array.from(allCollectionIds) } }] },
        select: { id: true, title: true },
      });
      validCollectionTitleSet = new Set(validCols.map((c) => c.title));
      collectionTitlesById = new Map(validCols.map(c => [c.id, c.title]));
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
            const imgUrl = p.ImageUrl || p.imageUrl || p.image || (Array.isArray(dbProduct.images) && (typeof dbProduct.images[0] === "string" ? dbProduct.images[0] : dbProduct.images[0]?.url || dbProduct.images[0]?.src)) || "";
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

        // Stable IDs survive renamed collections; titles support older exports.
        let validCollections = row.collectionTitles || [];
        if (ruleType === "collection" && (validCollections.length > 0 || row.collectionIds?.length > 0)) {
          validCollections = row.collectionIds?.length
            ? [...new Set(row.collectionIds.map(id => collectionTitlesById.get(collectionGid(id))).filter(Boolean))]
            : validCollections.filter((t) => validCollectionTitleSet.has(t));
          if (validCollections.length === 0) {
            skippedRows.push({
              id: externalId,
              reason: `Collection(s) not found in store: ${(row.collectionTitles || []).join(", ") || (row.collectionIds || []).join(", ")}`,
            });
            continue;
          }
        }

        // Determine applyToSearchType
        const applyToSearchType = row.applyToSearchType === "search" ? "page" : row.applyToSearchType || "both";
        const searchQueries = Array.isArray(row.searchQueries)
          ? row.searchQueries.filter(query => typeof query === "string" && query.trim()).map(query => query.trim())
          : row.searchQuery ? [row.searchQuery] : [];

        // Determine rule name and applyToAll
        let ruleName = "Imported Pin";
        let applyToAll = false;
        
        if (ruleType === "collection") {
          applyToAll = validCollections.length === 0;
          const originalTitles = (row.collectionTitles && row.collectionTitles.length > 0) 
            ? row.collectionTitles.join(", ") 
            : "";
          ruleName = originalTitles || "All Collections";
        } else {
          applyToAll = row.applyToAll === true || (row.applyToAll == null && searchQueries.length === 0);
          ruleName = applyToAll ? "All Searches" : searchQueries.join(", ");
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
            searchQueries,
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
            searchQueries,
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
    if (err instanceof Response) throw err;
    console.error("[import-pins-batch] Fatal error:", err);
    return Response.json(
      { imported: 0, skipped: 0, errors: [{ id: "batch", reason: err.message }] },
      { status: 500 }
    );
  }
};
